export const ALERT_RULE_TYPES = ["heartbeat", "threshold", "missing_field", "irregular_interval", "daily_sum", "battery_low", "battery_low_all"] as const;
export type AlertRuleType = (typeof ALERT_RULE_TYPES)[number];

export const ALERT_SEVERITIES = ["info", "warn", "critical"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_ROLES = ["consumption", "generation", "storage", "grid", "environment", "unknown"] as const;
export type AlertRole = (typeof ALERT_ROLES)[number];

export type AlertScope = {
  tenant: string;
  client?: string;
  site?: string;
  serial?: string;
  device?: string;
};

export type AlertRule = {
  id: string;
  name: string;
  enabled: boolean;
  type: AlertRuleType;
  severity: AlertSeverity;
  role?: AlertRole;
  scope: AlertScope;
  params: Record<string, unknown>;
  scheduleMinutes: number;
  activeHours?: { start: number; end: number };
  weekdays?: number[];
  notifications: {
    emails: string[];
    webhookUrl?: string;
    triggerMode: "edge" | "level";
    cooldownMinutes: number;
  };
  lastRunAt?: string;
  lastResult?: { ok: boolean; message: string };
  lastTriggeredAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AlertEvent = {
  id: string;
  timestamp: string;
  severity: AlertSeverity;
  ruleId: string;
  ruleName: string;
  scope: AlertScope;
  message: string;
  details?: string;
  debug?: Record<string, unknown>;
  status: "active" | "resolved" | "ack";
};

export type AlertsState = {
  engineStatus: "ok" | "error";
  lastRunAt?: string;
  avgEvalMs: number;
  rulesEvaluated: number;
  alertsTriggeredToday: number;
  lastError?: string;
};
