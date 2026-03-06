import { randomUUID } from "crypto";

import { AlertRule, ALERT_RULE_TYPES, ALERT_SEVERITIES } from "@/lib/alerts-types";

export function normalizeRule(payload: Partial<AlertRule>, prev?: AlertRule): AlertRule {
  if (!payload.name?.trim()) throw new Error("Nombre es obligatorio");
  if (!payload.scope?.tenant) throw new Error("Scope tenant es obligatorio");
  if (!payload.scope?.mode || !["per_device", "grouped"].includes(payload.scope.mode)) throw new Error("Scope mode inválido");
  if (!payload.type || !ALERT_RULE_TYPES.includes(payload.type)) throw new Error("Tipo de regla inválido");
  if (!payload.severity || !ALERT_SEVERITIES.includes(payload.severity)) throw new Error("Severidad inválida");
  const now = new Date().toISOString();

  return {
    id: prev?.id ?? randomUUID(),
    name: payload.name.trim(),
    enabled: payload.enabled ?? true,
    type: payload.type,
    severity: payload.severity,
    role: payload.role,
    scope: {
      tenant: payload.scope.tenant,
      client: payload.scope.client,
      site: payload.scope.site,
      serials: payload.scope.serials ?? [],
      deviceIds: payload.scope.deviceIds ?? [],
      role: payload.scope.role ?? payload.role,
      mode: payload.scope.mode,
    },
    params: payload.params ?? {},
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
