import { AlertRule } from "@/lib/alerts-types";

export type BatteryThresholds = {
  low: number;
  critical: number;
  cutoff: number;
};

export type BatteryProfile = {
  chemistry: string;
  nominalVoltage: number;
  thresholds: BatteryThresholds;
};

const DEFAULT_PROFILE: BatteryProfile = {
  chemistry: "li-ion",
  nominalVoltage: 3.6,
  thresholds: {
    low: 3.35,
    critical: 3.25,
    cutoff: 3.2,
  },
};

function asNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveBatteryProfile(rule: AlertRule): BatteryProfile {
  const params = (rule.params ?? {}) as Record<string, unknown>;
  const raw = (params.batteryProfile ?? {}) as Record<string, unknown>;
  const thresholds = (raw.thresholds ?? {}) as Record<string, unknown>;

  const profile: BatteryProfile = {
    chemistry: typeof raw.chemistry === "string" && raw.chemistry.trim() ? raw.chemistry : DEFAULT_PROFILE.chemistry,
    nominalVoltage: asNumber(raw.nominalVoltage, DEFAULT_PROFILE.nominalVoltage),
    thresholds: {
      low: asNumber(thresholds.low, DEFAULT_PROFILE.thresholds.low),
      critical: asNumber(thresholds.critical, DEFAULT_PROFILE.thresholds.critical),
      cutoff: asNumber(thresholds.cutoff, DEFAULT_PROFILE.thresholds.cutoff),
    },
  };

  if (profile.thresholds.critical > profile.thresholds.low) {
    profile.thresholds.critical = profile.thresholds.low;
  }
  if (profile.thresholds.cutoff > profile.thresholds.critical) {
    profile.thresholds.cutoff = profile.thresholds.critical;
  }
  return profile;
}

export function getVoltageThresholds(rule: AlertRule, level: "low" | "critical") {
  const profile = resolveBatteryProfile(rule);
  const params = (rule.params ?? {}) as Record<string, unknown>;

  const explicit = level === "low"
    ? asNumber(params.warningVoltage ?? params.thresholdVoltage, profile.thresholds.low)
    : asNumber(params.criticalVoltage, profile.thresholds.critical);

  return {
    threshold: explicit,
    profile,
  };
}
