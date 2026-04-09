import { AlertEvent, AlertRuleType } from "@/lib/alerts-types";

type EventPresentation = {
  headline: string;
  subheadline: string;
};

type EventDebug = Record<string, unknown>;

type AffectedDevice = {
  serial?: string;
  deviceId?: string;
  label?: string;
  batteryVoltage?: number;
  minutesWithoutData?: number;
};

function asDebug(debug: AlertEvent["debug"]): EventDebug {
  return (debug && typeof debug === "object" ? debug : {}) as EventDebug;
}

function cleanText(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : fallback;
}

function entityLabel(event: AlertEvent) {
  const item = event.affected[0];
  return cleanText(item?.label ?? item?.deviceId ?? item?.serial, "Dispositivo");
}

function formatCountLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getStaleCount(event: AlertEvent, debug: EventDebug) {
  const staleDevices = Array.isArray(debug.staleDevices) ? (debug.staleDevices as AffectedDevice[]) : [];
  return staleDevices.length || event.affected.length;
}

function resolveVoltage(event: AlertEvent, debug: EventDebug) {
  const lowDevices = Array.isArray(debug.lowDevices) ? (debug.lowDevices as AffectedDevice[]) : [];
  const criticalDevices = Array.isArray(debug.criticalDevices) ? (debug.criticalDevices as AffectedDevice[]) : [];
  const eventEntity = event.affected[0];
  const byEntity = [...criticalDevices, ...lowDevices].find((item) =>
    (eventEntity?.deviceId && item.deviceId === eventEntity.deviceId)
    || (eventEntity?.serial && item.serial === eventEntity.serial)
    || (eventEntity?.label && item.label === eventEntity.label),
  );
  const value = byEntity?.batteryVoltage ?? criticalDevices[0]?.batteryVoltage ?? lowDevices[0]?.batteryVoltage;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function groupedMessage(event: AlertEvent, ruleType: AlertRuleType | undefined, debug: EventDebug): EventPresentation | null {
  const count = event.affected.length;

  if (ruleType === "heartbeat") {
    if (event.status === "resolved") {
      return { headline: "Comunicación recuperada", subheadline: "Recuperación confirmada" };
    }
    const staleCount = getStaleCount(event, debug);
    return {
      headline: "Dispositivos sin comunicación",
      subheadline: `${formatCountLabel(staleCount, "equipo", "equipos")} sin datos`,
    };
  }

  if (ruleType?.startsWith("battery_voltage_critical")) {
    if (event.status === "resolved") {
      return {
        headline: "Grupo recuperado: voltajes fuera de zona crítica",
        subheadline: "Recuperación confirmada",
      };
    }
    const threshold = typeof debug.criticalVoltage === "number" ? debug.criticalVoltage.toFixed(2) : null;
    return {
      headline: "Voltaje crítico detectado",
      subheadline: threshold
        ? `${formatCountLabel(count, "equipo", "equipos")} por debajo de ${threshold} V`
        : `${formatCountLabel(count, "equipo", "equipos")} en voltaje crítico`,
    };
  }

  if (ruleType?.startsWith("battery_voltage_low")) {
    if (event.status === "resolved") {
      return {
        headline: "Voltajes en rango",
        subheadline: "Recuperación confirmada",
      };
    }
    const threshold = typeof debug.thresholdVoltage === "number" ? debug.thresholdVoltage.toFixed(2) : null;
    return {
      headline: "Voltaje bajo detectado",
      subheadline: threshold
        ? `${formatCountLabel(count, "equipo", "equipos")} por debajo de ${threshold} V`
        : `${formatCountLabel(count, "equipo", "equipos")} con voltaje bajo`,
    };
  }

  if (ruleType?.startsWith("battery_low")) {
    if (event.status === "resolved") {
      return { headline: "Baterías en rango", subheadline: "Recuperación confirmada" };
    }
    return {
      headline: "Batería baja detectada",
      subheadline: `${formatCountLabel(count, "equipo", "equipos")} por debajo del umbral`,
    };
  }

  return null;
}

function perDeviceMessage(event: AlertEvent, ruleType: AlertRuleType | undefined, debug: EventDebug): EventPresentation | null {
  const device = entityLabel(event);

  if (ruleType === "heartbeat") {
    if (event.status === "resolved") {
      return { headline: `${device} volvió a comunicar`, subheadline: "Comunicación restablecida" };
    }
    const minutes = typeof debug.inactivityMinutes === "number"
      ? debug.inactivityMinutes
      : (Array.isArray(debug.staleDevices) ? Number((debug.staleDevices[0] as AffectedDevice | undefined)?.minutesWithoutData ?? NaN) : NaN);
    if (Number.isFinite(minutes)) {
      return {
        headline: `${device} sin datos desde hace ${Math.round(minutes)} min`,
        subheadline: "Revisar enlace, energía o cobertura",
      };
    }
    return { headline: `${device} sin datos`, subheadline: "Revisar conectividad" };
  }

  if (ruleType?.startsWith("battery_voltage_critical")) {
    const voltage = resolveVoltage(event, debug);
    if (event.status === "resolved") {
      return { headline: `${device} recuperada: voltaje en rango`, subheadline: "Condición crítica normalizada" };
    }
    return {
      headline: voltage != null ? `${device} en voltaje crítico: ${voltage.toFixed(2)} V` : `${device} en voltaje crítico`,
      subheadline: "Revisión prioritaria recomendada",
    };
  }

  if (ruleType?.startsWith("battery_voltage_low")) {
    const voltage = resolveVoltage(event, debug);
    if (event.status === "resolved") {
      return { headline: `${device} recuperada: voltaje en rango`, subheadline: "Condición de bajo voltaje normalizada" };
    }
    return {
      headline: voltage != null ? `${device} con voltaje bajo: ${voltage.toFixed(2)} V` : `${device} con voltaje bajo`,
      subheadline: "Monitorear tendencia de descarga",
    };
  }

  if (ruleType?.startsWith("battery_low")) {
    if (event.status === "resolved") {
      return { headline: `${device} recuperada: batería en rango`, subheadline: "Nivel de batería normalizado" };
    }
    return { headline: `${device} con batería baja`, subheadline: "Revisar autonomía disponible" };
  }

  return null;
}

export function buildEventPresentation(event: AlertEvent, ruleType?: AlertRuleType): EventPresentation {
  const debug = asDebug(event.debug);
  const base: EventPresentation = {
    headline: cleanText(event.message, "Evento de alerta"),
    subheadline: event.status === "resolved"
      ? "Evento recuperado"
      : `Afectados: ${event.affected.length}`,
  };

  const semantic = event.scope.mode === "grouped"
    ? groupedMessage(event, ruleType, debug)
    : perDeviceMessage(event, ruleType, debug);

  const presentation = semantic ?? base;
  if (event.status === "ack") {
    return {
      headline: `En seguimiento · ${presentation.headline}`,
      subheadline: presentation.subheadline,
    };
  }
  return presentation;
}


type GroupedAffectedItem = {
  key: string;
  label: string;
  voltage: number | null;
};

function toEntityKey(item: { label?: string; deviceId?: string; serial?: string }, idx: number) {
  return item.deviceId ?? item.serial ?? item.label ?? `affected-${idx}`;
}

function safeLabel(item: { label?: string; deviceId?: string; serial?: string }, idx: number) {
  return cleanText(item.label ?? item.deviceId ?? item.serial, `Equipo ${idx + 1}`);
}

export function buildGroupedAffectedItems(event: AlertEvent): GroupedAffectedItem[] {
  if (event.scope.mode !== "grouped") return [];
  const debug = asDebug(event.debug);
  const lowDevices = Array.isArray(debug.lowDevices) ? (debug.lowDevices as AffectedDevice[]) : [];
  const criticalDevices = Array.isArray(debug.criticalDevices) ? (debug.criticalDevices as AffectedDevice[]) : [];
  const voltageByKey = new Map<string, number>();

  for (const item of [...criticalDevices, ...lowDevices]) {
    if (typeof item.batteryVoltage !== "number" || !Number.isFinite(item.batteryVoltage)) continue;
    const key = toEntityKey(item, 0);
    voltageByKey.set(key, item.batteryVoltage);
  }

  return event.affected.map((item, idx) => {
    const key = toEntityKey(item, idx);
    return {
      key,
      label: safeLabel(item, idx),
      voltage: voltageByKey.get(key) ?? null,
    };
  });
}

function formatAffectedItem(item: GroupedAffectedItem) {
  return item.voltage != null ? `${item.label} (${item.voltage.toFixed(2)} V)` : item.label;
}

export function buildGroupedAffectedSummary(event: AlertEvent): string | null {
  if (event.scope.mode !== "grouped") return null;
  const items = buildGroupedAffectedItems(event);
  const count = items.length;
  if (!count) return null;

  if (event.status === "resolved") {
    if (count === 1) return `Equipo recuperado: ${formatAffectedItem(items[0])}`;
    if (count <= 3) return `Equipos recuperados: ${items.map((item) => formatAffectedItem(item)).join(", ")}`;
    return `${count} equipos recuperados`;
  }

  if (count === 1) return formatAffectedItem(items[0]);
  if (count <= 3) return `${count} equipos afectados: ${items.map((item) => formatAffectedItem(item)).join(", ")}`;
  return `${count} equipos en fallo`;
}

export function buildEventOriginTrace(event: AlertEvent): string {
  const site = cleanText(event.scope?.site, "site-sin-definir");
  const serialCandidates = [
    ...(event.scope?.serials ?? []),
    ...event.affected.map((item) => item.serial).filter((value): value is string => typeof value === "string" && value.trim().length > 0),
  ];
  const uniqueSerials = Array.from(new Set(serialCandidates.map((item) => item.trim()).filter(Boolean)));
  const serialText = uniqueSerials.length ? uniqueSerials.join(", ") : "gateway-sin-definir";
  return `${site} · ${serialText}`;
}
