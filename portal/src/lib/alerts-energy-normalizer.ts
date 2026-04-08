import { estimateBatteryPercentage } from "@/lib/battery-estimation";
import { AlertRule } from "@/lib/alerts-types";

export type NormalizedEnergySample = {
  deviceId: string;
  serial?: string;
  label?: string;
  voltage?: number;
  percentageEstimated?: number;
  percentageIsEstimated?: boolean;
  timestamp?: string;
  lastSeen?: string;
};

type RawEnergySample = {
  deviceId: string;
  battery?: number;
  batteryVoltage?: number;
  serial?: string;
  label?: string;
  ts?: string;
  lastSeenAt?: string;
};

export function normalizeEnergySamples(rule: AlertRule, rawSamples: RawEnergySample[]): NormalizedEnergySample[] {
  const params = (rule.params ?? {}) as Record<string, unknown>;
  return rawSamples
    .filter((item) => item.deviceId)
    .map((item) => {
      const voltage = item.batteryVoltage == null ? undefined : Number(item.batteryVoltage);
      const directPercent = item.battery == null ? undefined : Number(item.battery);
      const estimated = (directPercent == null && voltage != null)
        ? estimateBatteryPercentage(voltage, {
          name: typeof params.batteryCurveName === "string" ? params.batteryCurveName : undefined,
          points: Array.isArray(params.batteryCurvePoints)
            ? (params.batteryCurvePoints as Array<{ voltage: number; percent: number }>)
            : undefined,
        })
        : null;

      return {
        deviceId: item.deviceId,
        serial: item.serial,
        label: item.label ?? item.deviceId,
        voltage,
        percentageEstimated: directPercent ?? estimated?.estimatedPercent,
        percentageIsEstimated: directPercent == null,
        timestamp: item.ts,
        lastSeen: item.lastSeenAt,
      };
    });
}

export function filterSamplesByScope(rule: AlertRule, samples: NormalizedEnergySample[]) {
  return samples.filter((sample) => {
    if (rule.scope.deviceIds?.length && !rule.scope.deviceIds.includes(sample.deviceId)) return false;
    if (rule.scope.serials?.length && sample.serial && !rule.scope.serials.includes(sample.serial)) return false;
    return true;
  });
}
