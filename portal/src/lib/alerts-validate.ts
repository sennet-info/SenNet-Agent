import { randomUUID } from "crypto";

import { AlertRule, ALERT_RULE_TYPES, ALERT_SEVERITIES } from "@/lib/alerts-types";

function ensureNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeParamsByType(type: AlertRule["type"], params: Record<string, unknown>) {
  if (type === "heartbeat") {
    const expectedIntervalMinutes = Math.max(1, ensureNumber(params.expectedIntervalMinutes ?? params.expectedMinutes, 5));
    const staleMultiplier = Math.max(1, ensureNumber(params.staleMultiplier ?? params.multiplier, 3));
    const timeoutMinutes = Math.max(1, ensureNumber(params.timeoutMinutes ?? params.minutesWithoutData, expectedIntervalMinutes * staleMultiplier));
    return {
      ...params,
      expectedIntervalMinutes,
      staleMultiplier,
      timeoutMinutes,
      minutesWithoutData: timeoutMinutes,
    };
  }
  if (type === "threshold") {
    return {
      ...params,
      operator: String(params.operator ?? "gt"),
      value: ensureNumber(params.value, 0),
      mockValue: params.mockValue == null ? params.mockValue : ensureNumber(params.mockValue, 0),
    };
  }
  if (type === "daily_sum") {
    return {
      ...params,
      operator: String(params.operator ?? "gt"),
      target: ensureNumber(params.target, 0),
      windowHours: Math.max(1, ensureNumber(params.windowHours, 24)),
      mockValue: params.mockValue == null ? params.mockValue : ensureNumber(params.mockValue, 0),
    };
  }
  if (type === "missing_field") {
    return {
      ...params,
      field: String(params.field ?? "").trim(),
    };
  }
  if (type === "irregular_interval") {
    const expected = Math.max(1, ensureNumber(params.expectedMinutes ?? params.expectedIntervalMinutes, 5));
    return {
      ...params,
      expectedMinutes: expected,
      expectedIntervalMinutes: expected,
      toleranceMinutes: Math.max(0, ensureNumber(params.toleranceMinutes, 2)),
      mockObservedGapMinutes: params.mockObservedGapMinutes == null ? params.mockObservedGapMinutes : ensureNumber(params.mockObservedGapMinutes, expected),
    };
  }
  if (type === "battery_low" || type === "battery_low_any" || type === "battery_low_all") {
    return {
      ...params,
      threshold: Math.min(100, Math.max(1, ensureNumber(params.threshold, 20))),
    };
  }
  if (
    type === "battery_voltage_low_any"
    || type === "battery_voltage_low_all"
    || type === "battery_voltage_critical_any"
    || type === "battery_voltage_critical_all"
  ) {
    const warningVoltage = ensureNumber(params.warningVoltage ?? params.thresholdVoltage, 3.3);
    const criticalVoltage = ensureNumber(params.criticalVoltage, 3.2);
    const cutoffVoltage = ensureNumber(params.cutoffVoltage, 3.2);
    return {
      ...params,
      warningVoltage,
      criticalVoltage: Math.min(warningVoltage, criticalVoltage),
      cutoffVoltage: Math.min(criticalVoltage, cutoffVoltage),
      batteryProfile: {
        chemistry: "li-ion",
        nominalVoltage: ensureNumber(((params.batteryProfile as Record<string, unknown> | undefined)?.nominalVoltage), 3.6),
        thresholds: {
          low: warningVoltage,
          critical: Math.min(warningVoltage, criticalVoltage),
          cutoff: Math.min(criticalVoltage, cutoffVoltage),
        },
      },
    };
  }
  return params;
}

export function normalizeRule(payload: Partial<AlertRule>, prev?: AlertRule): AlertRule {
  if (!payload.name?.trim()) throw new Error("Nombre es obligatorio");
  if (!payload.scope?.tenant) throw new Error("Scope tenant es obligatorio");
  if (!payload.scope?.mode || !["per_device", "grouped"].includes(payload.scope.mode)) throw new Error("Scope mode inválido");
  if (!payload.type || !ALERT_RULE_TYPES.includes(payload.type)) throw new Error("Tipo de regla inválido");
  if (!payload.severity || !ALERT_SEVERITIES.includes(payload.severity)) throw new Error("Severidad inválida");
  const now = new Date().toISOString();
  const editableParams = (payload.params ?? {}) as Record<string, unknown>;
  const internalParams = Object.fromEntries(
    Object.entries((prev?.params ?? {}) as Record<string, unknown>).filter(([key]) => key.startsWith("__")),
  );
  const normalizedParams = {
    ...normalizeParamsByType(payload.type, editableParams),
    ...internalParams,
  };
  if (payload.type === "missing_field" && !String(normalizedParams.field ?? "").trim()) {
    throw new Error("En missing_field el parámetro 'field' es obligatorio");
  }

  return {
    id: prev?.id ?? randomUUID(),
    name: payload.name.trim(),
    enabled: payload.enabled ?? true,
    type: payload.type,
    severity: payload.severity,
    role: payload.role,
    dataSource: payload.dataSource === "real" ? "real" : "mock",
    scope: {
      tenant: payload.scope.tenant,
      client: payload.scope.client,
      site: payload.scope.site,
      serials: payload.scope.serials ?? [],
      deviceIds: payload.scope.deviceIds ?? [],
      role: payload.scope.role ?? payload.role,
      mode: payload.scope.mode,
    },
    params: normalizedParams,
    scheduleMinutes: Math.max(1, Number(payload.scheduleMinutes ?? 5)),
    activeHours: payload.activeHours,
    weekdays: payload.weekdays,
    notifications: {
      emails: payload.notifications?.emails ?? [],
      groups: {
        client: payload.notifications?.groups?.client ?? [],
        maintenance: payload.notifications?.groups?.maintenance ?? [],
      },
      webhookUrl: payload.notifications?.webhookUrl,
      triggerMode: payload.notifications?.triggerMode ?? "edge",
      cooldownMinutes: Number(payload.notifications?.cooldownMinutes ?? 30),
    },
    lastRunAt: prev?.lastRunAt,
    lastResult: prev?.lastResult,
    lastTriggeredAt: prev?.lastTriggeredAt,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
}
