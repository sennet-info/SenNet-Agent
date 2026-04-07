import fs from "fs/promises";
import path from "path";

import { AlertEvent, AlertRule, AlertsState } from "@/lib/alerts-types";

const dataDir = process.env.ALERTS_DATA_DIR ?? "/opt/sennet-agent/alerts";
const rulesPath = path.join(dataDir, "alerts_rules.json");
const eventsPath = path.join(dataDir, "alerts_events.json");
const statePath = path.join(dataDir, "alerts_state.json");
const lockPath = path.join(dataDir, ".alerts.lock");

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

export async function appendEvent(event: AlertEvent) {
  return withLock(async () => {
    const events = await readJson<AlertEvent[]>(eventsPath, []);
    events.unshift(event);
    await atomicWrite(eventsPath, events.slice(0, 2000));
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
      await atomicWrite(eventsPath, events);
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
      await atomicWrite(eventsPath, next);
    }
    return { updatedCount };
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
