import { randomUUID } from "crypto";

import { notifyForEvent, previewDelivery } from "@/lib/alerts-notify";
import { filterSamplesByScope, normalizeEnergySamples } from "@/lib/alerts-energy-normalizer";
import { getVoltageThresholds } from "@/lib/alerts-energy-profile";
import { AlertDataSource, AlertEvent, AlertRule, AlertValidationDebug } from "@/lib/alerts-types";
import { appendEvent, cleanupEventsWithRetention, getState, listRules, resolveActiveEventsByRule, saveRules, saveState } from "@/lib/alerts-store";

type BatterySample = {
  deviceId: string;
  battery?: number;
  batteryVoltage?: number;
  serial?: string;
  label?: string;
  ts?: string;
  lastSeenAt?: string;
};

type RuleEvalResult = {
  fired: boolean;
  message: string;
  evaluationReason: string;
  inputsRaw: Record<string, unknown>;
  inputsUsed: Record<string, unknown>;
  typeSpecificDebug: Record<string, unknown>;
  affected: Array<{ serial?: string; deviceId?: string; label?: string }>;
};
type AffectedItem = { serial?: string; deviceId?: string; label?: string };
type EntityStateMap = Record<string, { status: "ok" | "fail"; lastChangeAt: string; meta?: AffectedItem }>;

type AlertsDataAdapter = {
  getBatterySamples: (rule: AlertRule) => Promise<BatterySample[]>;
};

const AGENT_BASE_URL = process.env.AGENT_BASE_URL ?? "http://127.0.0.1:8000";
const ENTITY_STATE_RETENTION_DAYS = Number(process.env.ALERTS_ENTITY_RETENTION_DAYS ?? 30);

function getRuleDataSource(rule: AlertRule): AlertDataSource {
  return rule.dataSource === "real" ? "real" : "mock";
}

const mockAdapter: AlertsDataAdapter = {
  async getBatterySamples(rule: AlertRule) {
    const sample = Array.isArray(rule.params.mockBatteries)
      ? (rule.params.mockBatteries as Array<{ device?: string; deviceId?: string; battery?: number; batteryVoltage?: number; voltage?: number; serial?: string; label?: string; ts?: string; lastSeenAt?: string }>)
      : [];
    return sample.map((item, idx) => ({
      deviceId: item.deviceId ?? item.device ?? `device-${idx + 1}`,
      battery: item.battery == null ? undefined : Number(item.battery),
      batteryVoltage: item.batteryVoltage == null
        ? (item.voltage == null ? undefined : Number(item.voltage))
        : Number(item.batteryVoltage),
      serial: item.serial,
      label: item.label,
      ts: item.ts,
      lastSeenAt: item.lastSeenAt,
    }));
  },
};

const realAdapter: AlertsDataAdapter = {
  async getBatterySamples(rule: AlertRule) {
    if (!rule.scope.tenant || !rule.scope.client || !rule.scope.site) return [];
    const query = new URLSearchParams({
      tenant: rule.scope.tenant,
      client: rule.scope.client,
      site: rule.scope.site,
      lookback_minutes: String(Number(rule.params.realLookbackMinutes ?? 180)),
    });
    if (rule.scope.serials?.[0]) query.set("serial", rule.scope.serials[0]);

    const response = await fetch(`${AGENT_BASE_URL.replace(/\/$/, "")}/v1/alerts/device-energy-status?${query.toString()}`, { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json().catch(() => ({}));
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items.map((item: Record<string, unknown>) => ({
      deviceId: String(item.deviceId ?? ""),
      batteryVoltage: item.batteryVoltage == null ? undefined : Number(item.batteryVoltage),
      serial: item.serial == null ? undefined : String(item.serial),
      label: item.label == null ? undefined : String(item.label),
      ts: item.batteryAt == null ? undefined : String(item.batteryAt),
      lastSeenAt: item.lastSeenAt == null ? undefined : String(item.lastSeenAt),
    })).filter((item: BatterySample) => item.deviceId);
  },
};

function nowIso() {
  return new Date().toISOString();
}

function fallbackAffectedFromScope(rule: AlertRule): AffectedItem[] {
  if (rule.scope.deviceIds?.length) {
    return rule.scope.deviceIds.map((deviceId) => ({ deviceId, label: deviceId }));
  }
  if (rule.scope.serials?.length) {
    return rule.scope.serials.map((serial) => ({ serial, label: serial }));
  }
  return [];
}

function buildEventsFromResult(rule: AlertRule, result: RuleEvalResult): AlertEvent[] {
  if (!result.fired) return [];
  const effectiveAffected = result.affected.length ? result.affected : fallbackAffectedFromScope(rule);

  if (rule.scope.mode === "grouped") {
    return [{ id: randomUUID(), timestamp: nowIso(), severity: rule.severity, ruleId: rule.id, ruleName: rule.name, scope: rule.scope, affected: effectiveAffected, message: result.message, details: "Condición de alerta activada", debug: result.typeSpecificDebug, status: "active" }];
  }

  const perDeviceSeed: AffectedItem[] = effectiveAffected.length ? effectiveAffected : [{ label: "scope" }];
  return perDeviceSeed.map((item) => ({
    id: randomUUID(),
    timestamp: nowIso(),
    severity: rule.severity,
    ruleId: rule.id,
    ruleName: rule.name,
    scope: { ...rule.scope, serials: item.serial ? [item.serial] : rule.scope.serials, deviceIds: item.deviceId ? [item.deviceId] : [] },
    affected: [item],
    message: item.label ? `${result.message} · ${item.label}` : result.message,
    details: "Condición de alerta activada",
    debug: result.typeSpecificDebug,
    status: "active",
  }));
}

function getEntityKey(item: AffectedItem, idx = 0) {
  return item.deviceId ?? item.serial ?? item.label ?? `entity-${idx}`;
}

function buildRecoveryEvent(rule: AlertRule, item: AffectedItem, sourceMessage: string): AlertEvent {
  return {
    id: randomUUID(), timestamp: nowIso(), severity: rule.severity, ruleId: rule.id, ruleName: rule.name,
    scope: { ...rule.scope, serials: item.serial ? [item.serial] : rule.scope.serials, deviceIds: item.deviceId ? [item.deviceId] : [] },
    affected: [item],
    message: `Recuperación: ${item.label ?? item.deviceId ?? item.serial ?? "entidad"} · ${sourceMessage}`,
    details: "Condición de alerta recuperada", debug: { transition: "fail_to_ok" }, status: "resolved",
  };
}

function evaluateComparison(value: number, threshold: number, operator: string) {
  if (operator === "<" || operator === "lt") return value < threshold;
  if (operator === "<=" || operator === "lte") return value <= threshold;
  if (operator === ">" || operator === "gt") return value > threshold;
  if (operator === "==" || operator === "=" || operator === "eq") return value === threshold;
  return value >= threshold;
}

function pickAdapter(rule: AlertRule) {
  return getRuleDataSource(rule) === "real" ? realAdapter : mockAdapter;
}

async function evalRule(rule: AlertRule, adapter: AlertsDataAdapter): Promise<RuleEvalResult> {
  const p = rule.params;

  if (rule.type === "heartbeat") {
    const expectedIntervalMinutes = Number(p.expectedIntervalMinutes ?? p.expectedMinutes ?? 5);
    const staleMultiplier = Number(p.staleMultiplier ?? p.multiplier ?? 3);
    const windowMinutes = Number(p.timeoutMinutes ?? p.windowMinutes ?? p.minutesWithoutData ?? (expectedIntervalMinutes * staleMultiplier));
    const dataSource = getRuleDataSource(rule);
    if (dataSource === "real") {
      const samples = await adapter.getBatterySamples(rule);
      const now = Date.now();
      const stale = samples
        .map((item) => {
          const lastSeenMs = item.lastSeenAt ? new Date(item.lastSeenAt).getTime() : 0;
          const minutesWithoutData = lastSeenMs ? Math.floor((now - lastSeenMs) / 60000) : Number.POSITIVE_INFINITY;
          return {
            ...item,
            minutesWithoutData,
            isStale: !Number.isFinite(minutesWithoutData) || minutesWithoutData > windowMinutes,
          };
        })
        .filter((item) => item.isStale);
      const affected = stale.map((item) => ({ serial: item.serial, deviceId: item.deviceId, label: item.label ?? item.deviceId }));
      const fired = affected.length > 0;
      const worst = stale.reduce((acc, item) => Math.max(acc, item.minutesWithoutData), 0);
      return {
        fired,
        message: fired ? `Equipo sin datos desde hace ${Number.isFinite(worst) ? worst : ">" + windowMinutes} min` : `Heartbeat OK (ventana ${windowMinutes} min)`,
        evaluationReason: fired ? "Se detectó pérdida de telemetría/heartbeat" : "Todos los equipos reportan dentro de ventana",
        inputsRaw: { minutesWithoutData: p.minutesWithoutData, dataSource: rule.dataSource, samplesCount: samples.length },
        inputsUsed: { expectedIntervalMinutes, staleMultiplier, timeoutMinutes: windowMinutes, staleCount: affected.length },
        typeSpecificDebug: { kind: "heartbeat_staleness", dataSource, staleDevices: stale.slice(0, 20) },
        affected,
      };
    }

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
      fired, message: `Valor ${value} ${operator} ${threshold}`,
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
      message: fired ? `Intervalo irregular: gap ${observedGapMinutes} min (máx ${maxAllowed})` : `Intervalo regular: gap ${observedGapMinutes} min (máx ${maxAllowed})`,
      evaluationReason: fired ? "Gap observado supera tolerancia" : "Gap observado dentro de tolerancia",
      inputsRaw: { expectedIntervalMinutes: p.expectedIntervalMinutes, toleranceMinutes: p.toleranceMinutes, mockObservedGapMinutes: p.mockObservedGapMinutes },
      inputsUsed: { expectedIntervalMinutes, toleranceMinutes, observedGapMinutes, maxAllowed },
      typeSpecificDebug: { kind: "irregular_interval" },
      affected: [],
    };
  }

  if ([
    "battery_low",
    "battery_low_any",
    "battery_low_all",
    "battery_voltage_low_any",
    "battery_voltage_low_all",
    "battery_voltage_critical_any",
    "battery_voltage_critical_all",
  ].includes(rule.type)) {
    const dataSource = getRuleDataSource(rule);
    const rawSamples = await adapter.getBatterySamples(rule);
    const normalizedSamples = filterSamplesByScope(rule, normalizeEnergySamples(rule, rawSamples));
    const scopedBatteries = normalizedSamples;

    const voltageRule = [
      "battery_voltage_low_any",
      "battery_voltage_low_all",
      "battery_voltage_critical_any",
      "battery_voltage_critical_all",
    ].includes(rule.type);
    if (voltageRule) {
      const severityLevel = rule.type.includes("critical") ? "critical" : "low";
      const { threshold, profile } = getVoltageThresholds(rule, severityLevel === "critical" ? "critical" : "low");
      const criticalVoltage = getVoltageThresholds(rule, "critical").threshold;
      const low = scopedBatteries
        .filter((item) => item.voltage != null && Number(item.voltage) < threshold)
        .map((item) => ({
          serial: item.serial,
          deviceId: item.deviceId,
          label: item.label ?? item.deviceId,
          batteryVoltage: Number(item.voltage),
        }));
      const isAll = rule.type.endsWith("_all");
      const fired = isAll ? scopedBatteries.length > 0 && low.length === scopedBatteries.length : low.length > 0;
      const critical = low.filter((item) => item.batteryVoltage < criticalVoltage);
      const msg = fired
        ? (critical.length > 0
          ? `Batería crítica: ${critical[0].batteryVoltage.toFixed(2)} V`
          : `Batería baja: ${low[0].batteryVoltage.toFixed(2)} V (umbral ${threshold.toFixed(2)} V)`)
        : `Baterías en rango (umbral ${threshold.toFixed(2)} V)`;
      return {
        fired,
        message: msg,
        evaluationReason: fired ? "Se detectó batería baja por voltaje real" : "Voltaje en rango",
        inputsRaw: { thresholdVoltage: threshold, criticalVoltage: p.criticalVoltage, dataSource, batteries: normalizedSamples.slice(0, 30) },
        inputsUsed: { thresholdVoltage: threshold, criticalVoltage, scopedBatteriesCount: scopedBatteries.length, lowCount: low.length, criticalCount: critical.length },
        typeSpecificDebug: { kind: "battery_voltage", level: severityLevel, mode: isAll ? "ALL" : "ANY", lowDevices: low, criticalDevices: critical, dataSource, profile },
        affected: low.map((item) => ({ serial: item.serial, deviceId: item.deviceId, label: item.label })),
      };
    }

    const threshold = Number(p.threshold ?? 20);
    const estimated = scopedBatteries;

    const affected = estimated
      .filter((item) => item.percentageEstimated != null && Number(item.percentageEstimated) < threshold)
      .map((item) => ({ serial: item.serial, deviceId: item.deviceId, label: item.label ?? item.deviceId }));
    const isAll = rule.type === "battery_low_all";
    const fired = isAll ? estimated.length > 0 && affected.length === estimated.length : affected.length > 0;
    const example = estimated.find((item) => item.percentageEstimated != null);
    return {
      fired,
      message: fired
        ? `Batería baja${example?.percentageIsEstimated ? " (estimada)" : ""}: ${affected.length}/${estimated.length} equipos bajo ${threshold}%`
        : `Baterías en rango (umbral ${threshold}%${example?.percentageIsEstimated ? " estimado" : ""})`,
      evaluationReason: fired ? "La condición de porcentaje de batería se cumple" : "La condición de porcentaje de batería no se cumple",
      inputsRaw: { threshold: p.threshold, dataSource, batteries: normalizedSamples.slice(0, 30) },
      inputsUsed: { threshold, scopedBatteriesCount: estimated.length, lowBatteriesCount: affected.length, estimatedFromVoltage: estimated.filter((item) => item.percentageIsEstimated).length },
      typeSpecificDebug: { mode: isAll ? "ALL" : "ANY", batteries: estimated.slice(0, 30), lowBatteryDevices: affected, metric: "estimated_percent" },
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

function pruneEntityMap(map: EntityStateMap, lastNotified: Record<string, string>) {
  const now = Date.now();
  const maxAgeMs = ENTITY_STATE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const next: EntityStateMap = {};
  const nextNotified: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    const lastChangeMs = value.lastChangeAt ? new Date(value.lastChangeAt).getTime() : 0;
    const lastNotifiedMs = lastNotified[key] ? new Date(lastNotified[key]).getTime() : 0;
    const newest = Math.max(lastChangeMs, lastNotifiedMs);
    const keepBecauseFresh = newest > 0 && (now - newest) <= maxAgeMs;
    const keep = value.status === "fail" || keepBecauseFresh;
    if (keep) {
      next[key] = value;
      if (lastNotified[key]) nextNotified[key] = lastNotified[key];
    }
  }
  return { next, nextNotified };
}

export async function evaluateRule(rule: AlertRule, manual = false) {
  const startedAt = nowIso();
  const t0 = Date.now();
  const adapter = pickAdapter(rule);
  const result = await evalRule(rule, adapter);
  const elapsed = Date.now() - t0;

  const previousOk = rule.lastResult?.ok ?? true;
  const cooldownMs = rule.notifications.cooldownMinutes * 60 * 1000;
  const failureEvents = buildEventsFromResult(rule, result);
  const rawParams = (rule.params ?? {}) as Record<string, unknown>;
  const prevEntityKeys = Array.isArray(rawParams.__activeEntityKeys) ? (rawParams.__activeEntityKeys as string[]) : [];
  const prevEntityMeta = (rawParams.__activeEntityMeta ?? {}) as Record<string, AffectedItem>;
  const prevEntityLastNotifiedAt = (rawParams.__entityLastNotifiedAt ?? {}) as Record<string, string>;
  const prevEntityState = (rawParams.__entityState ?? {}) as EntityStateMap;

  let simulatedEvents: AlertEvent[] = [];
  let edgeReason = "";
  let cooldownPass = true;
  let cooldownRemaining = 0;
  let cooldownBlocked = false;
  let enteredFailKeys: string[] = [];
  let recoveredKeys: string[] = [];
  let currentEntityState: EntityStateMap = {};

  if (rule.scope.mode === "grouped") {
    const shouldNotifyByEdge = rule.notifications.triggerMode === "edge" ? previousOk !== !result.fired : result.fired;
    edgeReason = rule.notifications.triggerMode === "edge" ? (shouldNotifyByEdge ? "Cambio de estado de grupo detectado" : "Sin cambio de borde de grupo respecto al estado previo") : (result.fired ? "Modo level notifica mientras la condición de grupo esté activa" : "Modo level sin condición activa");
    const elapsedSinceLastTrigger = rule.lastTriggeredAt ? Date.now() - new Date(rule.lastTriggeredAt).getTime() : cooldownMs;
    cooldownPass = !rule.lastTriggeredAt || elapsedSinceLastTrigger >= cooldownMs;
    cooldownRemaining = Math.max(0, cooldownMs - elapsedSinceLastTrigger);

    if (result.fired && shouldNotifyByEdge) simulatedEvents = failureEvents;
    if (!result.fired && !previousOk && shouldNotifyByEdge) {
      simulatedEvents = [{ id: randomUUID(), timestamp: nowIso(), severity: rule.severity, ruleId: rule.id, ruleName: rule.name, scope: rule.scope, affected: fallbackAffectedFromScope(rule), message: `Recuperación de grupo: ${rule.name}`, details: "Condición de alerta recuperada", debug: { transition: "fail_to_ok", mode: "grouped" }, status: "resolved" }];
    }
    const isRecoveryEvent = simulatedEvents.some((event) => event.status === "resolved");
    if (simulatedEvents.length && !cooldownPass && !isRecoveryEvent) {
      cooldownBlocked = true;
      simulatedEvents = [];
    }
  } else {
    const currentMap = new Map<string, AffectedItem>();
    for (const [idx, event] of failureEvents.entries()) {
      const item = event.affected[0] ?? { label: `entity-${idx}` };
      currentMap.set(getEntityKey(item, idx), item);
    }
    const now = nowIso();
    const previouslyFailingKeys = Object.entries(prevEntityState).filter(([, value]) => value.status === "fail").map(([key]) => key);
    const knownKeys = new Set<string>([
      ...previouslyFailingKeys,
      ...prevEntityKeys,
      ...Array.from(currentMap.keys()),
      ...(rule.scope.deviceIds ?? []),
      ...(rule.scope.serials ?? []),
    ]);
    currentEntityState = {};
    enteredFailKeys = [];
    recoveredKeys = [];
    for (const key of knownKeys) {
      const prev = prevEntityState[key];
      const prevStatus = prev?.status ?? "ok";
      const currStatus: "ok" | "fail" = currentMap.has(key) ? "fail" : "ok";
      if (prevStatus === "ok" && currStatus === "fail") enteredFailKeys.push(key);
      if (prevStatus === "fail" && currStatus === "ok") recoveredKeys.push(key);
      currentEntityState[key] = { status: currStatus, lastChangeAt: prevStatus === currStatus ? (prev?.lastChangeAt ?? now) : now, meta: currentMap.get(key) ?? prev?.meta ?? prevEntityMeta[key] };
    }
    const currentKeys = Object.entries(currentEntityState).filter(([, value]) => value.status === "fail").map(([key]) => key);
    const failKeysToEmit = rule.notifications.triggerMode === "edge" ? enteredFailKeys : currentKeys;
    const failEventsToEmit = failureEvents.filter((event, idx) => failKeysToEmit.includes(getEntityKey(event.affected[0] ?? { label: `entity-${idx}` }, idx)));
    const recoveryEventsToEmit = recoveredKeys.map((key) => buildRecoveryEvent(rule, prevEntityMeta[key] ?? { label: key }, result.message));
    const candidateEvents = [...failEventsToEmit, ...recoveryEventsToEmit];

    simulatedEvents = candidateEvents.filter((event, idx) => {
      if (event.status === "resolved") return true;
      const key = getEntityKey(event.affected[0] ?? { label: `entity-${idx}` }, idx);
      const lastNotifiedAt = prevEntityLastNotifiedAt[key];
      const elapsedSinceLast = lastNotifiedAt ? Date.now() - new Date(lastNotifiedAt).getTime() : cooldownMs;
      return elapsedSinceLast >= cooldownMs;
    });
    cooldownBlocked = simulatedEvents.length < candidateEvents.length;
    edgeReason = rule.notifications.triggerMode === "edge" ? `Transiciones por entidad: fail=${enteredFailKeys.length}, recovery=${recoveredKeys.length}` : `Modo level por entidad: activas=${currentKeys.length}, recovery=${recoveredKeys.length}`;
    cooldownPass = simulatedEvents.length === candidateEvents.length;
    cooldownRemaining = cooldownPass ? 0 : cooldownMs;
  }

  const debugEnvelope: AlertValidationDebug = {
    rule_snapshot: { id: rule.id, name: rule.name, type: rule.type, severity: rule.severity, scope: rule.scope, notifications: rule.notifications, dataSource: getRuleDataSource(rule) },
    evaluation_started_at: startedAt,
    evaluation_elapsed_ms: elapsed,
    scope_resolved: { tenant: rule.scope.tenant, client: rule.scope.client, site: rule.scope.site, serials: rule.scope.serials ?? [], deviceIds: rule.scope.deviceIds ?? [], mode: rule.scope.mode, role: rule.scope.role },
    inputs_raw: result.inputsRaw,
    inputs_used: result.inputsUsed,
    fired: result.fired,
    message: result.message,
    evaluation_reason: result.evaluationReason,
    affected: result.affected,
    previous_state: { previous_ok: previousOk, last_run_at: rule.lastRunAt, last_triggered_at: rule.lastTriggeredAt, last_message: rule.lastResult?.message },
    edge_decision: { trigger_mode: rule.notifications.triggerMode, should_notify_by_edge: simulatedEvents.length > 0, reason: edgeReason },
    cooldown_decision: { cooldown_minutes: rule.notifications.cooldownMinutes, cooldown_pass: cooldownPass, cooldown_remaining_ms: cooldownRemaining, reason: cooldownPass ? "Cooldown cumplido" : "Cooldown activo" },
    would_create_events: simulatedEvents.length > 0,
    simulated_events: simulatedEvents,
    would_notify: simulatedEvents.length > 0,
    suppressed_by: [...(simulatedEvents.length ? [] : ["edge_or_condition"]), ...(cooldownBlocked ? ["cooldown"] : [])],
    delivery_preview: simulatedEvents.length ? previewDelivery(rule) : undefined,
    type_specific_debug: { ...result.typeSpecificDebug, enteredFailKeys, recoveredKeys, previousEntityState: prevEntityState, currentEntityState },
  };

  const createdEvents: AlertEvent[] = [];
  if (simulatedEvents.length > 0 && !manual) {
    for (const event of simulatedEvents) {
      const delivery = await notifyForEvent(rule, event);
      const enrichedEvent: AlertEvent = { ...event, debug: { deliveryPreview: delivery, validationSummary: { fired: debugEnvelope.fired, message: debugEnvelope.message, reason: debugEnvelope.evaluation_reason, dataSource: getRuleDataSource(rule) } } };
      await appendEvent(enrichedEvent);
      createdEvents.push(enrichedEvent);
    }
    const recoveryKeys = createdEvents.filter((event) => event.status === "resolved").map((event, idx) => getEntityKey(event.affected[0] ?? { label: `entity-${idx}` }, idx));
    if (recoveryKeys.length) await resolveActiveEventsByRule(rule.id, recoveryKeys);
  }

  const markNow = nowIso();
  const entityLastNotifiedAt = { ...prevEntityLastNotifiedAt };
  for (const [idx, event] of createdEvents.entries()) {
    const key = getEntityKey(event.affected[0] ?? { label: `entity-${idx}` }, idx);
    entityLastNotifiedAt[key] = markNow;
  }
  const currentEntityMap = new Map<string, AffectedItem>();
  for (const [idx, event] of failureEvents.entries()) {
    const item = event.affected[0] ?? { label: `entity-${idx}` };
    currentEntityMap.set(getEntityKey(item, idx), item);
  }
  const { next: prunedEntityState, nextNotified } = pruneEntityMap(currentEntityState, entityLastNotifiedAt);

  const updatedRule: AlertRule = {
    ...rule,
    params: {
      ...rawParams,
      __activeEntityKeys: Array.from(currentEntityMap.keys()),
      __activeEntityMeta: Object.fromEntries(currentEntityMap.entries()),
      __entityLastNotifiedAt: nextNotified,
      __entityState: prunedEntityState,
    },
    lastRunAt: markNow,
    lastResult: { ok: !result.fired, message: result.message },
    lastTriggeredAt: createdEvents.length ? markNow : rule.lastTriggeredAt,
    updatedAt: markNow,
  };

  return { updatedRule, createdEvents, createdEvent: createdEvents[0] ?? null, elapsed, fired: result.fired, message: result.message, debug: debugEnvelope, manual };
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
  await cleanupEventsWithRetention();
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
