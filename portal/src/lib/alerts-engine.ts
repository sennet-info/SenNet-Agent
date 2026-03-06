import { randomUUID } from "crypto";

import { notifyForEvent } from "@/lib/alerts-notify";
import { AlertEvent, AlertRule } from "@/lib/alerts-types";
import { appendEvent, getState, listRules, saveRules, saveState } from "@/lib/alerts-store";

type BatterySample = { deviceId: string; battery: number; serial?: string; label?: string; ts?: string };

type RuleEvalResult = {
  fired: boolean;
  message: string;
  debug: Record<string, unknown>;
  affected: Array<{ serial?: string; deviceId?: string; label?: string }>;
};

type AlertsDataAdapter = {
  getBatterySamples: (rule: AlertRule) => Promise<BatterySample[]>;
};

const mockAdapter: AlertsDataAdapter = {
  async getBatterySamples(rule: AlertRule) {
    const sample = Array.isArray(rule.params.mockBatteries)
      ? (rule.params.mockBatteries as Array<{ device?: string; deviceId?: string; battery: number; serial?: string; label?: string; ts?: string }>)
      : [];
    return sample.map((item, idx) => ({
      deviceId: item.deviceId ?? item.device ?? `device-${idx + 1}`,
      battery: Number(item.battery ?? 0),
      serial: item.serial,
      label: item.label,
      ts: item.ts,
    }));
  },
};

function nowIso() {
  return new Date().toISOString();
}

function buildEventsFromResult(rule: AlertRule, result: RuleEvalResult): AlertEvent[] {
  if (!result.fired) return [];

  if (rule.scope.mode === "grouped") {
    return [
      {
        id: randomUUID(),
        timestamp: nowIso(),
        severity: rule.severity,
        ruleId: rule.id,
        ruleName: rule.name,
        scope: rule.scope,
        affected: result.affected,
        message: result.message,
        details: "Condición de alerta activada",
        debug: result.debug,
        status: "active",
      },
    ];
  }

  return result.affected.map((item) => ({
    id: randomUUID(),
    timestamp: nowIso(),
    severity: rule.severity,
    ruleId: rule.id,
    ruleName: rule.name,
    scope: {
      ...rule.scope,
      serials: item.serial ? [item.serial] : rule.scope.serials,
      deviceIds: item.deviceId ? [item.deviceId] : [],
    },
    affected: [item],
    message: item.label ? `${result.message} · ${item.label}` : result.message,
    details: "Condición de alerta activada",
    debug: result.debug,
    status: "active",
  }));
}

async function evalRule(rule: AlertRule, adapter: AlertsDataAdapter): Promise<RuleEvalResult> {
  const p = rule.params;
  if (rule.type === "heartbeat") {
    const lastPointMinutes = Number(p.mockLastPointMinutesAgo ?? 9999);
    const windowMinutes = Number(p.windowMinutes ?? 15);
    return {
      fired: lastPointMinutes > windowMinutes,
      message: lastPointMinutes > windowMinutes ? `Sin datos en ${lastPointMinutes} min (umbral ${windowMinutes})` : "Datos en ventana OK",
      debug: { lastPointMinutes, windowMinutes },
      affected: [],
    };
  }

  if (rule.type === "threshold" || rule.type === "daily_sum") {
    const value = Number(p.mockValue ?? 0);
    const threshold = Number(p.threshold ?? 0);
    const operator = String(p.operator ?? ">=");
    const fired = operator === "<" ? value < threshold : operator === "<=" ? value <= threshold : operator === ">" ? value > threshold : value >= threshold;
    return { fired, message: `Valor ${value} ${operator} ${threshold}`, debug: { value, operator, threshold }, affected: [] };
  }

  if (rule.type === "battery_low" || rule.type === "battery_low_any" || rule.type === "battery_low_all") {
    const threshold = Number(p.threshold ?? 20);
    const batteries = await adapter.getBatterySamples(rule);
    const scopedBatteries = batteries.filter((sample) => {
      if (rule.scope.deviceIds?.length && !rule.scope.deviceIds.includes(sample.deviceId)) return false;
      if (rule.scope.serials?.length && sample.serial && !rule.scope.serials.includes(sample.serial)) return false;
      return true;
    });
    const affected = scopedBatteries
      .filter((item) => item.battery < threshold)
      .map((item) => ({ serial: item.serial, deviceId: item.deviceId, label: item.label ?? item.deviceId }));
    const isAll = rule.type === "battery_low_all";
    const fired = isAll ? scopedBatteries.length > 0 && affected.length === scopedBatteries.length : affected.length > 0;
    const modeLabel = isAll ? "ALL" : "ANY";
    return {
      fired,
      message: fired
        ? `${modeLabel}: ${affected.length}/${scopedBatteries.length} equipos bajo batería ${threshold}%`
        : `Baterías en rango (${modeLabel}, umbral ${threshold}%)`,
      debug: { threshold, mode: modeLabel, affected, batteries: scopedBatteries },
      affected,
    };
  }

  return { fired: false, message: "Tipo no implementado en MVP", debug: { type: rule.type }, affected: [] };
}

export async function evaluateRule(rule: AlertRule, manual = false, adapter: AlertsDataAdapter = mockAdapter) {
  const t0 = Date.now();
  const result = await evalRule(rule, adapter);
  const elapsed = Date.now() - t0;

  const previousOk = rule.lastResult?.ok ?? true;
  const shouldNotifyByEdge = rule.notifications.triggerMode === "edge" ? previousOk !== !result.fired : result.fired;
  const cooldownMs = rule.notifications.cooldownMinutes * 60 * 1000;
  const cooldownPass = !rule.lastTriggeredAt || Date.now() - new Date(rule.lastTriggeredAt).getTime() >= cooldownMs;

  const createdEvents: AlertEvent[] = [];
  if (result.fired && shouldNotifyByEdge && cooldownPass) {
    const events = buildEventsFromResult(rule, result);
    for (const event of events) {
      const delivery = await notifyForEvent(rule, event);
      const enrichedEvent: AlertEvent = {
        ...event,
        debug: {
          ...(event.debug ?? {}),
          deliveryPreview: delivery,
        },
      };
      await appendEvent(enrichedEvent);
      createdEvents.push(enrichedEvent);
    }
  }

  const markNow = nowIso();
  const updatedRule: AlertRule = {
    ...rule,
    lastRunAt: markNow,
    lastResult: { ok: !result.fired, message: result.message },
    lastTriggeredAt: createdEvents.length ? markNow : rule.lastTriggeredAt,
    updatedAt: markNow,
  };

  return { updatedRule, createdEvents, createdEvent: createdEvents[0] ?? null, elapsed, debug: result.debug, manual };
}

export async function runAllRules() {
  const rules = await listRules();
  const started = Date.now();
  let fired = 0;
  const updated: AlertRule[] = [];

  for (const rule of rules) {
    if (!rule.enabled) {
      updated.push(rule);
      continue;
    }
    const out = await evaluateRule(rule);
    updated.push(out.updatedRule);
    fired += out.createdEvents.length;
  }

  await saveRules(updated);
  const prev = await getState();
  await saveState({
    ...prev,
    engineStatus: "ok",
    lastRunAt: nowIso(),
    rulesEvaluated: updated.filter((r) => r.enabled).length,
    avgEvalMs: updated.length ? Math.round((Date.now() - started) / Math.max(updated.length, 1)) : 0,
    alertsTriggeredToday: prev.alertsTriggeredToday + fired,
    lastError: undefined,
  });

  return { ok: true, evaluated: updated.length, fired };
}
