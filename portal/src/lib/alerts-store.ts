import fs from "fs/promises";
import path from "path";

import { AlertEvent, AlertRule, AlertsState } from "@/lib/alerts-types";

const dataDir = process.env.ALERTS_DATA_DIR ?? "/opt/sennet-agent/alerts";
const rulesPath = path.join(dataDir, "alerts_rules.json");
const eventsPath = path.join(dataDir, "alerts_events.json");
const statePath = path.join(dataDir, "alerts_state.json");
const lockPath = path.join(dataDir, ".alerts.lock");
const retentionDays = Number(process.env.ALERTS_EVENTS_RETENTION_DAYS ?? 7);
const maxEvents = Number(process.env.ALERTS_EVENTS_MAX ?? 2000);

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(dataDir, { recursive: true });
  for (let i = 0; i < 30; i += 1) {
    try {
      await fs.mkdir(lockPath);
      try {
        return await fn();
      } finally {
        await fs.rmdir(lockPath).catch(() => undefined);
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("No se pudo adquirir lock de alertas");
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function atomicWrite(filePath: string, data: unknown) {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}

export async function listRules() {
  return readJson<AlertRule[]>(rulesPath, []);
}

export async function saveRules(rules: AlertRule[]) {
  return withLock(async () => {
    await atomicWrite(rulesPath, rules);
    return rules;
  });
}

export async function listEvents() {
  return readJson<AlertEvent[]>(eventsPath, []);
}

function applyRetention(events: AlertEvent[]) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const active = events.filter((item) => item.status === "active");
  const retainedInactive = events.filter((item) => {
    if (item.status === "active") return false;
    const ts = new Date(item.timestamp).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  });
  return [...active, ...retainedInactive]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, maxEvents);
}

export async function cleanupEventsWithRetention() {
  return withLock(async () => {
    const events = await readJson<AlertEvent[]>(eventsPath, []);
    const retained = applyRetention(events);
    if (retained.length !== events.length) {
      await atomicWrite(eventsPath, retained);
    }
    return { before: events.length, after: retained.length };
  });
}

export async function appendEvent(event: AlertEvent) {
  return withLock(async () => {
    const events = await readJson<AlertEvent[]>(eventsPath, []);
    events.unshift(event);
    await atomicWrite(eventsPath, applyRetention(events));
    return event;
  });
}

export async function deleteEvent(eventId: string) {
  return withLock(async () => {
    const events = await readJson<AlertEvent[]>(eventsPath, []);
    const idx = events.findIndex((item) => item.id === eventId);
    if (idx < 0) return null;
    const [removed] = events.splice(idx, 1);
    await atomicWrite(eventsPath, events);
    return removed;
  });
}

export async function clearEvents(options?: { onlyResolved?: boolean; status?: AlertEvent["status"] | "all" }) {
  return withLock(async () => {
    const events = await readJson<AlertEvent[]>(eventsPath, []);
    let keep: AlertEvent[] = [];
    if (options?.status && options.status !== "all") {
      keep = events.filter((item) => item.status !== options.status);
    } else if (options?.onlyResolved) {
      keep = events.filter((item) => item.status !== "resolved");
    }
    const removed = events.length - keep.length;
    await atomicWrite(eventsPath, keep);
    return { removed, remaining: keep.length };
  });
}

export async function updateEvent(eventId: string, status: AlertEvent["status"]) {
  return withLock(async () => {
    const events = await readJson<AlertEvent[]>(eventsPath, []);
    const idx = events.findIndex((item) => item.id === eventId);
    if (idx >= 0) {
      events[idx] = { ...events[idx], status };
      await atomicWrite(eventsPath, applyRetention(events));
      return events[idx];
    }
    return null;
  });
}

export async function resolveActiveEventsByRule(ruleId: string, entityKeys: string[]) {
  return withLock(async () => {
    const events = await readJson<AlertEvent[]>(eventsPath, []);
    const keySet = new Set(entityKeys);
    let updatedCount = 0;
    const next = events.map((event) => {
      if (event.ruleId !== ruleId || event.status !== "active") return event;
      if (!keySet.size) {
        updatedCount += 1;
        return { ...event, status: "resolved" as const };
      }
      const affectedKeys = (event.affected ?? []).map((item) => item.deviceId ?? item.serial ?? item.label).filter(Boolean) as string[];
      if (affectedKeys.some((key) => keySet.has(key))) {
        updatedCount += 1;
        return { ...event, status: "resolved" as const };
      }
      return event;
    });
    if (updatedCount) {
      await atomicWrite(eventsPath, applyRetention(next));
    }
    return { updatedCount };
  });
}

export async function upsertGroupedActiveEvent(nextEvent: AlertEvent) {
  return withLock(async () => {
    const events = await readJson<AlertEvent[]>(eventsPath, []);
    let keptOne = false;
    let targetId: string | null = null;
    const next = events.map((event) => {
      if (event.ruleId !== nextEvent.ruleId || event.status !== "active" || event.scope?.mode !== "grouped") return event;
      if (!keptOne) {
        keptOne = true;
        targetId = event.id;
        return {
          ...event,
          timestamp: nextEvent.timestamp,
          severity: nextEvent.severity,
          ruleName: nextEvent.ruleName,
          scope: nextEvent.scope,
          affected: nextEvent.affected,
          message: nextEvent.message,
          details: nextEvent.details,
          debug: nextEvent.debug,
        };
      }
      return { ...event, status: "resolved" as const };
    });

    const merged = keptOne ? next : [nextEvent, ...next];
    await atomicWrite(eventsPath, applyRetention(merged));
    return { updated: keptOne, eventId: targetId ?? nextEvent.id };
  });
}

export async function getState() {
  return readJson<AlertsState>(statePath, {
    engineStatus: "ok",
    avgEvalMs: 0,
    rulesEvaluated: 0,
    alertsTriggeredToday: 0,
  });
}

export async function saveState(state: AlertsState) {
  return withLock(async () => {
    await atomicWrite(statePath, state);
    return state;
  });
}
