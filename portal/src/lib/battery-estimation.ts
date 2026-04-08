export type BatteryCurvePoint = { voltage: number; percent: number };

export type BatteryEstimationConfig = {
  name?: string;
  points?: BatteryCurvePoint[];
};

export const DEFAULT_LI36_CURVE: BatteryCurvePoint[] = [
  { voltage: 3.2, percent: 0 },
  { voltage: 3.3, percent: 10 },
  { voltage: 3.4, percent: 25 },
  { voltage: 3.5, percent: 45 },
  { voltage: 3.6, percent: 65 },
  { voltage: 3.7, percent: 80 },
  { voltage: 3.8, percent: 92 },
  { voltage: 4.0, percent: 100 },
];

function normalizeCurve(points?: BatteryCurvePoint[]) {
  const source = Array.isArray(points) && points.length >= 2 ? points : DEFAULT_LI36_CURVE;
  return source
    .map((item) => ({ voltage: Number(item.voltage), percent: Number(item.percent) }))
    .filter((item) => Number.isFinite(item.voltage) && Number.isFinite(item.percent))
    .sort((a, b) => a.voltage - b.voltage);
}

export function estimateBatteryPercentage(voltage: number, config?: BatteryEstimationConfig) {
  const curve = normalizeCurve(config?.points);
  if (!curve.length || !Number.isFinite(voltage)) {
    return { estimatedPercent: 0, estimated: true, curveName: config?.name ?? "li-ion-3.6-default", curveUsed: curve };
  }

  if (voltage <= curve[0].voltage) {
    return {
      estimatedPercent: Math.max(0, Math.min(100, curve[0].percent)),
      estimated: true,
      curveName: config?.name ?? "li-ion-3.6-default",
      curveUsed: curve,
    };
  }

  const top = curve[curve.length - 1];
  if (voltage >= top.voltage) {
    return {
      estimatedPercent: Math.max(0, Math.min(100, top.percent)),
      estimated: true,
      curveName: config?.name ?? "li-ion-3.6-default",
      curveUsed: curve,
    };
  }

  for (let i = 1; i < curve.length; i += 1) {
    const left = curve[i - 1];
    const right = curve[i];
    if (voltage <= right.voltage) {
      const ratio = (voltage - left.voltage) / Math.max(1e-9, right.voltage - left.voltage);
      const estimatedPercent = left.percent + ratio * (right.percent - left.percent);
      return {
        estimatedPercent: Math.max(0, Math.min(100, Math.round(estimatedPercent * 10) / 10)),
        estimated: true,
        curveName: config?.name ?? "li-ion-3.6-default",
        curveUsed: curve,
      };
    }
  }

  return { estimatedPercent: 0, estimated: true, curveName: config?.name ?? "li-ion-3.6-default", curveUsed: curve };
}
