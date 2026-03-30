import { randomUUID } from "crypto";

import { notifyForEvent, previewDelivery } from "@/lib/alerts-notify";
import { AlertEvent, AlertRule, AlertValidationDebug } from "@/lib/alerts-types";
import { appendEvent, getState, listRules, saveRules, saveState } from "@/lib/alerts-store";

type BatterySample = { deviceId: string; battery: number; serial?: string; label?: string; ts?: string };

type RuleEvalResult = {
  fired: boolean;
  message: string;
  evaluationReason: string;
  inputsRaw: Record<string, unknown>;
  inputsUsed: Record<string, unknown>;
  typeSpecificDebug: Record<string, unknown>;
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
        debug: result.typeSpecificDebug,
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
    debug: result.typeSpecificDebug,
    status: "active",
  }));
}

function evaluateComparison(value: number, threshold: number, operator: string) {
  if (operator === "<" || operator === "lt") return value < threshold;
  if (operator === "<=" || operator === "lte") return value <= threshold;
  if (operator === ">" || operator === "gt") return value > threshold;
  if (operator === "==" || operator === "=" || operator === "eq") return value === threshold;
  return value >= threshold;
}

async function evalRule(rule: AlertRule, adapter: AlertsDataAdapter): Promise<RuleEvalResult> {
  const p = rule.params;

  if (rule.type === "heartbeat") {
    const windowMinutes = Number(p.windowMinutes ?? p.minutesWithoutData ?? 15);
    const lastPointMinutes = Number(p.mockLastPointMinutesAgo ?? 9999);
    const fired = lastPointMinutes > windowMinutes;
    return {
      fired,
      message: fired ? `Sin datos en ${lastPointMinutes} min (umbral ${windowMinutes})` : "Datos en ventana OK",
      evaluationReason: fired ? "Último dato fuera de ventana esperada" : "Último dato dentro de ventana esperada",
      inputsRaw: { mockLastPointMinutesAgo: p.mockLastPointMinutesAgo, windowMinutes: p.windowMinutes, minutesWithoutData: p.minutesWithoutData },
      inputsUsed: { lastPointMinutes, windowMinutes },
      typeSpecificDebug: { kind: "heartbeat", inactivityMinutes: lastPointMinutes, expectedWindowMinutes: windowMinutes },
      affected: [],
    };
  }

  if (rule.type === "threshold" || rule.type === "daily_sum") {
    const value = Number(p.mockValue ?? p.value ?? 0);
    const threshold = Number(p.threshold ?? p.target ?? p.value ?? 0);
    const operator = String(p.operator ?? ">=");
    const fired = evaluateComparison(value, threshold, operator);
    return {
      fired,
      message: `Valor ${value} ${operator} ${threshold}`,
      evaluationReason: fired ? "Comparación numérica cumplida" : "Comparación numérica no cumplida",
      inputsRaw: { mockValue: p.mockValue, value: p.value, threshold: p.threshold, target: p.target, operator: p.operator },
      inputsUsed: { value, threshold, operator },
      typeSpecificDebug: { kind: rule.type, metric: p.metric ?? "value", windowHours: p.windowHours },
      affected: [],
    };
  }

  if (rule.type === "missing_field") {
    const field = String(p.field ?? "value");
    const rows = Array.isArray(p.mockRows) ? (p.mockRows as Array<Record<string, unknown>>) : [];
    const missing = rows.filter((row) => row[field] == null || row[field] === "");
    const fired = missing.length > 0;
    return {
      fired,
      message: fired ? `Campo ${field} ausente en ${missing.length} registros` : `Campo ${field} presente en todos los registros`,
      evaluationReason: fired ? "Se detectaron valores ausentes" : "No se detectaron valores ausentes",
      inputsRaw: { field: p.field, mockRows: rows },
      inputsUsed: { field, inspectedRows: rows.length, missingRows: missing.length },
      typeSpecificDebug: { kind: "missing_field", missingExamples: missing.slice(0, 5) },
      affected: [],
    };
  }

  if (rule.type === "irregular_interval") {
    const expectedIntervalMinutes = Number(p.expectedIntervalMinutes ?? p.expectedMinutes ?? 5);
    const toleranceMinutes = Number(p.toleranceMinutes ?? 2);
    const observedGapMinutes = Number(p.mockObservedGapMinutes ?? expectedIntervalMinutes);
    const maxAllowed = expectedIntervalMinutes + toleranceMinutes;
    const fired = observedGapMinutes > maxAllowed;
    return {
      fired,
      message: fired
        ? `Intervalo irregular: gap ${observedGapMinutes} min (máx ${maxAllowed})`
        : `Intervalo regular: gap ${observedGapMinutes} min (máx ${maxAllowed})`,
      evaluationReason: fired ? "Gap observado supera tolerancia" : "Gap observado dentro de tolerancia",
      inputsRaw: { expectedIntervalMinutes: p.expectedIntervalMinutes, toleranceMinutes: p.toleranceMinutes, mockObservedGapMinutes: p.mockObservedGapMinutes },
      inputsUsed: { expectedIntervalMinutes, toleranceMinutes, observedGapMinutes, maxAllowed },
      typeSpecificDebug: { kind: "irregular_interval" },
      affected: [],
    };
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
      evaluationReason: fired ? "La condición de batería configurada se cumple" : "La condición de batería configurada no se cumple",
      inputsRaw: { threshold: p.threshold, batteries },
      inputsUsed: { threshold, scopedBatteriesCount: scopedBatteries.length, lowBatteriesCount: affected.length, mode: modeLabel },
      typeSpecificDebug: { mode: modeLabel, batteries: scopedBatteries, lowBatteryDevices: affected },
      affected,
    };
  }

  return {
    fired: false,
    message: "Tipo no implementado en MVP",
    evaluationReason: "No existe evaluador para este tipo de regla",
    inputsRaw: { type: rule.type, params: rule.params },
    inputsUsed: {},
    typeSpecificDebug: { type: rule.type },
    affected: [],
  };
}

export async function evaluateRule(rule: AlertRule, manual = false, adapter: AlertsDataAdapter = mockAdapter) {
  const startedAt = nowIso();
  const t0 = Date.now();
  const result = await evalRule(rule, adapter);
  const elapsed = Date.now() - t0;

  const previousOk = rule.lastResult?.ok ?? true;
  const shouldNotifyByEdge = rule.notifications.triggerMode === "edge" ? previousOk !== !result.fired : result.fired;
  const edgeReason = rule.notifications.triggerMode === "edge"
    ? (shouldNotifyByEdge ? "Cambio de estado detectado" : "Sin cambio de borde respecto al estado previo")
    : (result.fired ? "Modo level notifica mientras la condición esté activa" : "Modo level sin condición activa");

  const cooldownMs = rule.notifications.cooldownMinutes * 60 * 1000;
  const elapsedSinceLastTrigger = rule.lastTriggeredAt ? Date.now() - new Date(rule.lastTriggeredAt).getTime() : cooldownMs;
  const cooldownPass = !rule.lastTriggeredAt || elapsedSinceLastTrigger >= cooldownMs;
  const cooldownRemaining = Math.max(0, cooldownMs - elapsedSinceLastTrigger);

  const simulatedEvents = buildEventsFromResult(rule, result);
  const wouldCreateEvents = result.fired && shouldNotifyByEdge && cooldownPass;
  const wouldNotify = wouldCreateEvents;
  const suppressedBy = [
    ...(result.fired ? [] : ["condition_false"]),
    ...(result.fired && !shouldNotifyByEdge ? ["edge"] : []),
    ...(result.fired && shouldNotifyByEdge && !cooldownPass ? ["cooldown"] : []),
  ];

  const deliveryPreview = wouldNotify ? previewDelivery(rule) : undefined;

  const debugEnvelope: AlertValidationDebug = {
    rule_snapshot: {
      id: rule.id,
      name: rule.name,
      type: rule.type,
      severity: rule.severity,
      scope: rule.scope,
      notifications: rule.notifications,
    },
    evaluation_started_at: startedAt,
    evaluation_elapsed_ms: elapsed,
    scope_resolved: {
      tenant: rule.scope.tenant,
      client: rule.scope.client,
      site: rule.scope.site,
      serials: rule.scope.serials ?? [],
      deviceIds: rule.scope.deviceIds ?? [],
      mode: rule.scope.mode,
      role: rule.scope.role,
    },
    inputs_raw: result.inputsRaw,
    inputs_used: result.inputsUsed,
    fired: result.fired,
    message: result.message,
    evaluation_reason: result.evaluationReason,
    affected: result.affected,
    previous_state: {
      previous_ok: previousOk,
      last_run_at: rule.lastRunAt,
      last_triggered_at: rule.lastTriggeredAt,
      last_message: rule.lastResult?.message,
    },
    edge_decision: {
      trigger_mode: rule.notifications.triggerMode,
      should_notify_by_edge: shouldNotifyByEdge,
      reason: edgeReason,
    },
    cooldown_decision: {
      cooldown_minutes: rule.notifications.cooldownMinutes,
      cooldown_pass: cooldownPass,
      cooldown_remaining_ms: cooldownRemaining,
      reason: cooldownPass ? "Cooldown cumplido" : "Cooldown activo",
    },
    would_create_events: wouldCreateEvents,
    simulated_events: simulatedEvents,
    would_notify: wouldNotify,
    suppressed_by: suppressedBy,
    delivery_preview: deliveryPreview,
    type_specific_debug: result.typeSpecificDebug,
  };

  const createdEvents: AlertEvent[] = [];
  if (wouldCreateEvents && !manual) {
    for (const event of simulatedEvents) {
      const delivery = await notifyForEvent(rule, event);
      const enrichedEvent: AlertEvent = {
        ...event,
        debug: {
          ...(event.debug ?? {}),
          deliveryPreview: delivery,
          validation: debugEnvelope,
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

  return {
    updatedRule,
    createdEvents,
    createdEvent: createdEvents[0] ?? null,
    elapsed,
    fired: result.fired,
    message: result.message,
    debug: debugEnvelope,
    manual,
  };
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
