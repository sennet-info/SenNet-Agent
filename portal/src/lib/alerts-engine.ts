import { randomUUID } from "crypto";

import { AlertEvent, AlertRule } from "@/lib/alerts-types";
import { appendEvent, getState, listRules, saveRules, saveState } from "@/lib/alerts-store";

function nowIso() {
  return new Date().toISOString();
}

function evalRule(rule: AlertRule): { fired: boolean; message: string; debug: Record<string, unknown> } {
  const p = rule.params;
  if (rule.type === "heartbeat") {
    const lastPointMinutes = Number(p.mockLastPointMinutesAgo ?? 9999);
    const windowMinutes = Number(p.windowMinutes ?? 15);
    return {
      fired: lastPointMinutes > windowMinutes,
      message: lastPointMinutes > windowMinutes ? `Sin datos en ${lastPointMinutes} min (umbral ${windowMinutes})` : "Datos en ventana OK",
      debug: { lastPointMinutes, windowMinutes },
    };
  }

  if (rule.type === "threshold" || rule.type === "daily_sum") {
    const value = Number(p.mockValue ?? 0);
    const threshold = Number(p.threshold ?? 0);
    const operator = String(p.operator ?? ">=");
    const fired = operator === "<" ? value < threshold : operator === "<=" ? value <= threshold : operator === ">" ? value > threshold : value >= threshold;
    return { fired, message: `Valor ${value} ${operator} ${threshold}`, debug: { value, operator, threshold } };
  }

  if (rule.type === "battery_low" || rule.type === "battery_low_all") {
    const threshold = Number(p.threshold ?? 20);
    const batteries = Array.isArray(p.mockBatteries) ? (p.mockBatteries as Array<{ device: string; battery: number; ts?: string }>) : [];
    const affected = batteries.filter((item) => item.battery < threshold);
    const fired = rule.type === "battery_low_all" ? batteries.length > 0 && affected.length === batteries.length : affected.length > 0;
    return {
      fired,
      message: fired ? `${affected.length} equipos por debajo de batería ${threshold}%` : "Baterías en rango",
      debug: { threshold, affected, batteries },
    };
  }

  return { fired: false, message: "Tipo no implementado en MVP", debug: { type: rule.type } };
}

export async function evaluateRule(rule: AlertRule, manual = false) {
  const t0 = Date.now();
  const result = evalRule(rule);
  const elapsed = Date.now() - t0;

  const previousOk = rule.lastResult?.ok ?? true;
  const shouldNotifyByEdge = rule.notifications.triggerMode === "edge" ? previousOk !== !result.fired : result.fired;
  const cooldownMs = rule.notifications.cooldownMinutes * 60 * 1000;
  const cooldownPass = !rule.lastTriggeredAt || Date.now() - new Date(rule.lastTriggeredAt).getTime() >= cooldownMs;

  let createdEvent: AlertEvent | null = null;
  if (result.fired && shouldNotifyByEdge && cooldownPass) {
    createdEvent = {
      id: randomUUID(),
      timestamp: nowIso(),
      severity: rule.severity,
      ruleId: rule.id,
      ruleName: rule.name,
      scope: rule.scope,
      message: result.message,
      details: result.fired ? "Condición de alerta activada" : "Sin alerta",
      debug: result.debug,
      status: "active",
    };
    await appendEvent(createdEvent);
  }

  const updatedRule: AlertRule = {
    ...rule,
    lastRunAt: nowIso(),
    lastResult: { ok: !result.fired, message: result.message },
    lastTriggeredAt: createdEvent ? nowIso() : rule.lastTriggeredAt,
    updatedAt: nowIso(),
  };

  return { updatedRule, createdEvent, elapsed, debug: result.debug, manual };
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
    if (out.createdEvent) fired += 1;
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
