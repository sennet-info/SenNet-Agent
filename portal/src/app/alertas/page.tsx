"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { buildEventPresentation } from "@/lib/alerts-event-messages";
import {
  ALERT_DATA_SOURCES,
  ALERT_ROLES,
  ALERT_RULE_TYPES,
  ALERT_SEVERITIES,
  AlertEvent,
  AlertRole,
  AlertRule,
  AlertRuleType,
  AlertsState,
  AlertValidationDebug,
} from "@/lib/alerts-types";

type DiscoveryState = {
  tenants: string[];
  clients: string[];
  sites: string[];
  serials: string[];
  devices: string[];
};

type AlertTypeConfig = {
  label: string;
  description: string;
  defaults: Record<string, unknown>;
  summary: (params: Record<string, unknown>) => string;
  render: (props: ParamRendererProps) => JSX.Element;
};

type ParamRendererProps = {
  params: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
};

const notificationDefaults: AlertRule["notifications"] = {
  emails: [],
  groups: { client: [], maintenance: [] },
  triggerMode: "edge",
  cooldownMinutes: 30,
};

const baseScope: AlertRule["scope"] = {
  tenant: "",
  mode: "grouped",
  serials: [],
  deviceIds: [],
};

const emptyRule: Partial<AlertRule> = {
  name: "",
  enabled: true,
  type: "battery_low_any",
  severity: "warn",
  dataSource: "mock",
  scope: baseScope,
  params: { threshold: 20 },
  scheduleMinutes: 5,
  notifications: notificationDefaults,
};

const alertTypeConfig: Record<AlertRuleType, AlertTypeConfig> = {
  battery_low_any: {
    label: "Batería baja (cualquiera)",
    description: "Se dispara cuando al menos un dispositivo cae por debajo del umbral.",
    defaults: { threshold: 20 },
    summary: (params) => `Umbral batería: ${Number(params.threshold ?? 20)}%`,
    render: ({ params, onChange }) => (
      <FieldBlock label="Umbral batería (%)" help="Aplica para equipos con batería. Define el mínimo aceptable antes de disparar.">
        <input
          type="number"
          min={1}
          max={100}
          className={inputClass}
          value={Number(params.threshold ?? 20)}
          onChange={(e) => onChange("threshold", Number(e.target.value))}
        />
      </FieldBlock>
    ),
  },
  battery_voltage_low_any: {
    label: "Batería baja por voltaje (cualquiera)",
    description: "Se dispara cuando al menos un dispositivo cae por debajo de umbral de voltaje real (V).",
    defaults: { warningVoltage: 3.3, criticalVoltage: 3.2 },
    summary: (params) => `Umbral: < ${Number(params.warningVoltage ?? 3.3).toFixed(2)} V (crítico < ${Number(params.criticalVoltage ?? 3.2).toFixed(2)} V)`,
    render: ({ params, onChange }) => (
      <div className="grid gap-3 md:grid-cols-2">
        <FieldBlock label="Warning (V)">
          <input type="number" step="0.01" className={inputClass} value={Number(params.warningVoltage ?? 3.3)} onChange={(e) => onChange("warningVoltage", Number(e.target.value))} />
        </FieldBlock>
        <FieldBlock label="Critical (V)">
          <input type="number" step="0.01" className={inputClass} value={Number(params.criticalVoltage ?? 3.2)} onChange={(e) => onChange("criticalVoltage", Number(e.target.value))} />
        </FieldBlock>
      </div>
    ),
  },
  battery_voltage_low_all: {
    label: "Batería baja por voltaje (todos)",
    description: "Se dispara cuando todos los dispositivos del scope están por debajo de umbral de voltaje real (V).",
    defaults: { warningVoltage: 3.3, criticalVoltage: 3.2 },
    summary: (params) => `Umbral: < ${Number(params.warningVoltage ?? 3.3).toFixed(2)} V (crítico < ${Number(params.criticalVoltage ?? 3.2).toFixed(2)} V)`,
    render: ({ params, onChange }) => (
      <div className="grid gap-3 md:grid-cols-2">
        <FieldBlock label="Warning (V)">
          <input type="number" step="0.01" className={inputClass} value={Number(params.warningVoltage ?? 3.3)} onChange={(e) => onChange("warningVoltage", Number(e.target.value))} />
        </FieldBlock>
        <FieldBlock label="Critical (V)">
          <input type="number" step="0.01" className={inputClass} value={Number(params.criticalVoltage ?? 3.2)} onChange={(e) => onChange("criticalVoltage", Number(e.target.value))} />
        </FieldBlock>
      </div>
    ),
  },
  battery_voltage_critical_any: {
    label: "Batería crítica por voltaje (cualquiera)",
    description: "Se dispara cuando cualquier equipo cae bajo el umbral crítico de voltaje real (V).",
    defaults: { criticalVoltage: 3.25, warningVoltage: 3.35, cutoffVoltage: 3.2 },
    summary: (params) => `Crítica: < ${Number(params.criticalVoltage ?? 3.25).toFixed(2)} V`,
    render: ({ params, onChange }) => (
      <div className="grid gap-3 md:grid-cols-3">
        <FieldBlock label="Critical (V)">
          <input type="number" step="0.01" className={inputClass} value={Number(params.criticalVoltage ?? 3.25)} onChange={(e) => onChange("criticalVoltage", Number(e.target.value))} />
        </FieldBlock>
        <FieldBlock label="Low (V)">
          <input type="number" step="0.01" className={inputClass} value={Number(params.warningVoltage ?? 3.35)} onChange={(e) => onChange("warningVoltage", Number(e.target.value))} />
        </FieldBlock>
        <FieldBlock label="Cutoff (V)">
          <input type="number" step="0.01" className={inputClass} value={Number(params.cutoffVoltage ?? 3.2)} onChange={(e) => onChange("cutoffVoltage", Number(e.target.value))} />
        </FieldBlock>
      </div>
    ),
  },
  battery_voltage_critical_all: {
    label: "Batería crítica por voltaje (todos)",
    description: "Se dispara cuando todos los equipos del scope están bajo umbral crítico de voltaje real (V).",
    defaults: { criticalVoltage: 3.25, warningVoltage: 3.35, cutoffVoltage: 3.2 },
    summary: (params) => `Crítica ALL: < ${Number(params.criticalVoltage ?? 3.25).toFixed(2)} V`,
    render: ({ params, onChange }) => (
      <div className="grid gap-3 md:grid-cols-3">
        <FieldBlock label="Critical (V)">
          <input type="number" step="0.01" className={inputClass} value={Number(params.criticalVoltage ?? 3.25)} onChange={(e) => onChange("criticalVoltage", Number(e.target.value))} />
        </FieldBlock>
        <FieldBlock label="Low (V)">
          <input type="number" step="0.01" className={inputClass} value={Number(params.warningVoltage ?? 3.35)} onChange={(e) => onChange("warningVoltage", Number(e.target.value))} />
        </FieldBlock>
        <FieldBlock label="Cutoff (V)">
          <input type="number" step="0.01" className={inputClass} value={Number(params.cutoffVoltage ?? 3.2)} onChange={(e) => onChange("cutoffVoltage", Number(e.target.value))} />
        </FieldBlock>
      </div>
    ),
  },
  battery_low_all: {
    label: "Batería baja (todos)",
    description: "Se dispara cuando todos los dispositivos afectados están por debajo del umbral.",
    defaults: { threshold: 20 },
    summary: (params) => `Umbral batería: ${Number(params.threshold ?? 20)}%`,
    render: ({ params, onChange }) => (
      <FieldBlock label="Umbral batería (%)" help="Aplica para equipos con batería. La regla exige que todos estén bajo este valor.">
        <input
          type="number"
          min={1}
          max={100}
          className={inputClass}
          value={Number(params.threshold ?? 20)}
          onChange={(e) => onChange("threshold", Number(e.target.value))}
        />
      </FieldBlock>
    ),
  },
  heartbeat: {
    label: "Heartbeat / sin señal",
    description: "Controla inactividad cuando un equipo deja de reportar en el tiempo esperado.",
    defaults: { expectedIntervalMinutes: 5, staleMultiplier: 3, timeoutMinutes: 15 },
    summary: (params) => `Sin datos > ${Number(params.timeoutMinutes ?? 15)} min (esperado ${Number(params.expectedIntervalMinutes ?? 5)} min x ${Number(params.staleMultiplier ?? 3)})`,
    render: ({ params, onChange }) => (
      <div className="grid gap-3 md:grid-cols-3">
        <FieldBlock label="Intervalo esperado (min)">
          <input type="number" min={1} className={inputClass} value={Number(params.expectedIntervalMinutes ?? 5)} onChange={(e) => onChange("expectedIntervalMinutes", Number(e.target.value))} />
        </FieldBlock>
        <FieldBlock label="Multiplicador stale">
          <input type="number" min={1} className={inputClass} value={Number(params.staleMultiplier ?? 3)} onChange={(e) => onChange("staleMultiplier", Number(e.target.value))} />
        </FieldBlock>
        <FieldBlock label="Timeout absoluto (min)">
          <input type="number" min={1} className={inputClass} value={Number(params.timeoutMinutes ?? 15)} onChange={(e) => onChange("timeoutMinutes", Number(e.target.value))} />
        </FieldBlock>
      </div>
    ),
  },
  threshold: {
    label: "Umbral de métrica",
    description: "Dispara cuando una métrica supera o cae por debajo de un valor definido.",
    defaults: { metric: "value", operator: "gt", value: 0 },
    summary: (params) => `Condición: ${String(params.metric ?? "value")} ${String(params.operator ?? "gt")} ${String(params.value ?? 0)}`,
    render: ({ params, onChange }) => (
      <div className="grid gap-3 md:grid-cols-3">
        <FieldBlock label="Métrica" help="Ejemplo: voltage, power, temperature.">
          <input className={inputClass} placeholder="metric" value={String(params.metric ?? "value")} onChange={(e) => onChange("metric", e.target.value)} />
        </FieldBlock>
        <FieldBlock label="Operador" help="Selecciona cómo comparar la métrica con el umbral.">
          <select className={inputClass} value={String(params.operator ?? "gt")} onChange={(e) => onChange("operator", e.target.value)}>
            <option value="gt">Mayor que (&gt;)</option>
            <option value="gte">Mayor o igual (≥)</option>
            <option value="lt">Menor que (&lt;)</option>
            <option value="lte">Menor o igual (≤)</option>
            <option value="eq">Igual (=)</option>
          </select>
        </FieldBlock>
        <FieldBlock label="Valor umbral" help="Valor numérico para la comparación.">
          <input type="number" className={inputClass} value={Number(params.value ?? 0)} onChange={(e) => onChange("value", Number(e.target.value))} />
        </FieldBlock>
      </div>
    ),
  },
  daily_sum: {
    label: "Acumulado diario",
    description: "Evalúa el acumulado de una métrica dentro de una ventana temporal.",
    defaults: { metric: "energy", operator: "gt", target: 0, windowHours: 24 },
    summary: (params) => `Acumulado ${String(params.metric ?? "energy")}: ${String(params.operator ?? "gt")} ${String(params.target ?? 0)} en ${String(params.windowHours ?? 24)}h`,
    render: ({ params, onChange }) => (
      <div className="grid gap-3 md:grid-cols-2">
        <FieldBlock label="Métrica acumulada" help="Por ejemplo: energy_kwh.">
          <input className={inputClass} value={String(params.metric ?? "energy")} onChange={(e) => onChange("metric", e.target.value)} />
        </FieldBlock>
        <FieldBlock label="Valor objetivo" help="Límite del acumulado diario para disparar la alerta.">
          <input type="number" className={inputClass} value={Number(params.target ?? 0)} onChange={(e) => onChange("target", Number(e.target.value))} />
        </FieldBlock>
        <FieldBlock label="Operador" help="Comparación frente al valor objetivo.">
          <select className={inputClass} value={String(params.operator ?? "gt")} onChange={(e) => onChange("operator", e.target.value)}>
            <option value="gt">Mayor que</option>
            <option value="gte">Mayor o igual</option>
            <option value="lt">Menor que</option>
            <option value="lte">Menor o igual</option>
          </select>
        </FieldBlock>
        <FieldBlock label="Ventana (horas)" help="Periodo de acumulación que analiza la regla.">
          <input type="number" min={1} max={48} className={inputClass} value={Number(params.windowHours ?? 24)} onChange={(e) => onChange("windowHours", Number(e.target.value))} />
        </FieldBlock>
      </div>
    ),
  },
  battery_low: {
    label: "Batería baja",
    description: "Regla de compatibilidad para versiones anteriores.",
    defaults: { threshold: 20 },
    summary: (params) => `Umbral batería: ${Number(params.threshold ?? 20)}%`,
    render: ({ params, onChange }) => (
      <FieldBlock label="Umbral batería (%)" help="Disponible por compatibilidad con reglas existentes.">
        <input type="number" min={1} max={100} className={inputClass} value={Number(params.threshold ?? 20)} onChange={(e) => onChange("threshold", Number(e.target.value))} />
      </FieldBlock>
    ),
  },
  missing_field: {
    label: "Campo faltante",
    description: "Dispara cuando falta un campo obligatorio en el payload.",
    defaults: { field: "" },
    summary: (params) => `Campo obligatorio: ${String(params.field ?? "-")}`,
    render: ({ params, onChange }) => (
      <FieldBlock label="Campo requerido" help="Nombre exacto del campo que debe existir en el dato recibido.">
        <input className={inputClass} placeholder="ej: battery" value={String(params.field ?? "")} onChange={(e) => onChange("field", e.target.value)} />
      </FieldBlock>
    ),
  },
  irregular_interval: {
    label: "Intervalo irregular",
    description: "Detecta variaciones no esperadas en el intervalo de reporte.",
    defaults: { expectedMinutes: 5, toleranceMinutes: 2 },
    summary: (params) => `Esperado: ${Number(params.expectedMinutes ?? 5)} min ± ${Number(params.toleranceMinutes ?? 2)} min`,
    render: ({ params, onChange }) => (
      <div className="grid gap-3 md:grid-cols-2">
        <FieldBlock label="Intervalo esperado (min)" help="Frecuencia de reporte normal del equipo.">
          <input type="number" min={1} className={inputClass} value={Number(params.expectedMinutes ?? 5)} onChange={(e) => onChange("expectedMinutes", Number(e.target.value))} />
        </FieldBlock>
        <FieldBlock label="Tolerancia (min)" help="Desviación permitida antes de disparar la alerta.">
          <input type="number" min={0} className={inputClass} value={Number(params.toleranceMinutes ?? 2)} onChange={(e) => onChange("toleranceMinutes", Number(e.target.value))} />
        </FieldBlock>
      </div>
    ),
  },
};

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-500";

function csvToList(input: string) {
  return input.split(",").map((item) => item.trim()).filter(Boolean);
}

const typeMockPresets: Record<AlertRuleType, { low: Record<string, unknown>; critical?: Record<string, unknown>; ok: Record<string, unknown> }> = {
  battery_low_any: {
    low: { mockBatteries: [{ deviceId: "bat-1", battery: 17, serial: "GW-100", label: "Batería A" }, { deviceId: "bat-2", battery: 44, serial: "GW-100", label: "Batería B" }] },
    ok: { mockBatteries: [{ deviceId: "bat-1", battery: 60, serial: "GW-100", label: "Batería A" }, { deviceId: "bat-2", battery: 74, serial: "GW-100", label: "Batería B" }] },
  },
  battery_voltage_low_any: {
    low: { mockBatteries: [{ deviceId: "bat-1", voltage: 3.29, serial: "GW-100", label: "Batería A" }] },
    critical: { mockBatteries: [{ deviceId: "bat-1", voltage: 3.19, serial: "GW-100", label: "Batería A" }] },
    ok: { mockBatteries: [{ deviceId: "bat-1", voltage: 3.45, serial: "GW-100", label: "Batería A" }] },
  },
  battery_voltage_low_all: {
    low: { mockBatteries: [{ deviceId: "bat-1", voltage: 3.29, serial: "GW-100", label: "Batería A" }, { deviceId: "bat-2", voltage: 3.27, serial: "GW-100", label: "Batería B" }] },
    critical: { mockBatteries: [{ deviceId: "bat-1", voltage: 3.19, serial: "GW-100", label: "Batería A" }, { deviceId: "bat-2", voltage: 3.18, serial: "GW-100", label: "Batería B" }] },
    ok: { mockBatteries: [{ deviceId: "bat-1", voltage: 3.49, serial: "GW-100", label: "Batería A" }, { deviceId: "bat-2", voltage: 3.45, serial: "GW-100", label: "Batería B" }] },
  },
  battery_voltage_critical_any: {
    low: { mockBatteries: [{ deviceId: "bat-1", voltage: 3.22, serial: "GW-100", label: "Batería A" }] },
    critical: { mockBatteries: [{ deviceId: "bat-1", voltage: 3.19, serial: "GW-100", label: "Batería A" }] },
    ok: { mockBatteries: [{ deviceId: "bat-1", voltage: 3.39, serial: "GW-100", label: "Batería A" }] },
  },
  battery_voltage_critical_all: {
    low: { mockBatteries: [{ deviceId: "bat-1", voltage: 3.22, serial: "GW-100", label: "Batería A" }, { deviceId: "bat-2", voltage: 3.23, serial: "GW-100", label: "Batería B" }] },
    critical: { mockBatteries: [{ deviceId: "bat-1", voltage: 3.19, serial: "GW-100", label: "Batería A" }, { deviceId: "bat-2", voltage: 3.18, serial: "GW-100", label: "Batería B" }] },
    ok: { mockBatteries: [{ deviceId: "bat-1", voltage: 3.39, serial: "GW-100", label: "Batería A" }, { deviceId: "bat-2", voltage: 3.37, serial: "GW-100", label: "Batería B" }] },
  },
  battery_low_all: {
    low: { mockBatteries: [{ deviceId: "bat-1", battery: 15, serial: "GW-100", label: "Batería A" }, { deviceId: "bat-2", battery: 19, serial: "GW-100", label: "Batería B" }] },
    ok: { mockBatteries: [{ deviceId: "bat-1", battery: 60, serial: "GW-100", label: "Batería A" }, { deviceId: "bat-2", battery: 19, serial: "GW-100", label: "Batería B" }] },
  },
  battery_low: {
    low: { mockBatteries: [{ deviceId: "bat-1", battery: 16, serial: "GW-100", label: "Batería A" }] },
    ok: { mockBatteries: [{ deviceId: "bat-1", battery: 65, serial: "GW-100", label: "Batería A" }] },
  },
  heartbeat: { low: { mockLastPointMinutesAgo: 45, timeoutMinutes: 15, expectedIntervalMinutes: 5, staleMultiplier: 3 }, ok: { mockLastPointMinutesAgo: 3, timeoutMinutes: 15, expectedIntervalMinutes: 5, staleMultiplier: 3 } },
  threshold: { low: { mockValue: 120 }, ok: { mockValue: -5 } },
  daily_sum: { low: { mockValue: 180 }, ok: { mockValue: 20 } },
  missing_field: { low: { mockRows: [{ value: 12 }, { value: null }, {}] }, ok: { mockRows: [{ value: 12 }, { value: 18 }] } },
  irregular_interval: { low: { mockObservedGapMinutes: 12 }, ok: { mockObservedGapMinutes: 5 } },
};

function isRuleUsingMockData(rule: AlertRule | Partial<AlertRule>) {
  if ((rule.dataSource ?? "mock") === "mock") return true;
  const params = (rule.params ?? {}) as Record<string, unknown>;
  return Object.keys(params).some((key) => key.startsWith("mock"));
}

function eventStatusClass(status: AlertEvent["status"]) {
  if (status === "resolved") return "bg-emerald-900/60 text-emerald-200";
  if (status === "ack") return "bg-blue-900/60 text-blue-200";
  return "bg-amber-900/60 text-amber-200";
}

function normalizeEventForView(event: AlertEvent) {
  const fallbackAffected = Array.isArray((event.debug as Record<string, unknown> | undefined)?.affected)
    ? ((event.debug as Record<string, unknown>).affected as Array<{ serial?: string; deviceId?: string; label?: string }>)
    : [];

  return {
    ...event,
    status: event.status ?? "active",
    affected: event.affected ?? fallbackAffected,
    scope: {
      ...event.scope,
      mode: event.scope?.mode ?? "grouped",
    },
  };
}

function FieldBlock({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-slate-200">{label}</span>
      {children}
      {help ? <p className="text-xs text-slate-400">{help}</p> : null}
    </label>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm shadow-slate-950/30">
      <header className="mb-4">
        <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
        <p className="text-sm text-slate-400">{subtitle}</p>
      </header>
      {children}
    </article>
  );
}



function ValidationModal({ result, onClose }: { result: AlertValidationDebug; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Validación de alerta</h3>
          <button className="rounded-lg border border-slate-700 px-3 py-1 text-xs" onClick={onClose}>Cerrar</button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard title="1. Resumen" subtitle="Resultado general de la evaluación.">
            <ul className="space-y-1 text-sm text-slate-300">
              <li><b>Regla:</b> {result.rule_snapshot.name}</li>
              <li><b>Tipo:</b> {result.rule_snapshot.type}</li>
              <li><b>Severidad:</b> {result.rule_snapshot.severity}</li>
              <li><b>Fuente datos:</b> {result.rule_snapshot.dataSource ?? "mock"}</li>
              <li><b>Scope:</b> {result.scope_resolved.tenant} / {result.scope_resolved.client ?? "-"} / {result.scope_resolved.site ?? "-"}</li>
              <li><b>Modo:</b> {result.scope_resolved.mode}</li>
              <li><b>Inicio:</b> {result.evaluation_started_at}</li>
              <li><b>Duración:</b> {result.evaluation_elapsed_ms} ms</li>
              <li><b>Resultado:</b> {result.fired ? "DISPARA" : "NO DISPARA"}</li>
            </ul>
          </SectionCard>
          <SectionCard title="2. Datos analizados" subtitle="Entradas crudas, transformadas y cobertura.">
            <p className="text-xs text-slate-400">Afectados: {result.affected.length} · serials: {result.scope_resolved.serials.length} · devices: {result.scope_resolved.deviceIds.length}</p>
            <pre className="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 text-xs">{JSON.stringify({ inputs_raw: result.inputs_raw, inputs_used: result.inputs_used }, null, 2)}</pre>
          </SectionCard>
          <SectionCard title="3. Lógica de decisión" subtitle="Explicación humana del disparo/supresión.">
            <ul className="space-y-1 text-sm text-slate-300">
              <li><b>Mensaje:</b> {result.message}</li>
              <li><b>Motivo:</b> {result.evaluation_reason}</li>
              <li><b>Edge:</b> {result.edge_decision.reason}</li>
              <li><b>Cooldown:</b> {result.cooldown_decision.reason} ({result.cooldown_decision.cooldown_remaining_ms} ms restantes)</li>
              <li><b>Suprimida por:</b> {result.suppressed_by.join(", ") || "ninguno"}</li>
            </ul>
          </SectionCard>
          <SectionCard title="4. Eventos simulados" subtitle="Qué eventos se crearían en grouped/per_device.">
            <p className="text-sm text-slate-300">Se crearían: {result.would_create_events ? result.simulated_events.length : 0} evento(s)</p>
            <pre className="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 text-xs">{JSON.stringify(result.simulated_events, null, 2)}</pre>
          </SectionCard>
          <SectionCard title="5. Notificación simulada" subtitle="Preview de envío y supresiones.">
            <p className="text-sm text-slate-300">¿Notificaría?: {result.would_notify ? "Sí" : "No"}</p>
            <pre className="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 text-xs">{JSON.stringify(result.delivery_preview ?? {}, null, 2)}</pre>
          </SectionCard>
          <SectionCard title="6. JSON técnico" subtitle="Bloque completo para soporte y desarrollo.">
            <pre className="overflow-auto rounded-lg bg-slate-950 p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

export default function AlertasPage() {
  const [eventsStatusFilter, setEventsStatusFilter] = useState<"active" | "resolved" | "all">("active");
  const [token, setToken] = useState("");
  const [tab, setTab] = useState<"rules" | "events" | "status">("rules");
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [status, setStatus] = useState<AlertsState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingRuleId, setTestingRuleId] = useState<string | null>(null);
  const [runningNow, setRunningNow] = useState(false);
  const [runFeedback, setRunFeedback] = useState<{ evaluated: number; fired: number; ranAt: string } | null>(null);
  const [validationResult, setValidationResult] = useState<AlertValidationDebug | null>(null);
  const [testParamsText, setTestParamsText] = useState("{}");
  const [form, setForm] = useState<Partial<AlertRule>>(emptyRule);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryState>({ tenants: [], clients: [], sites: [], serials: [], devices: [] });

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }), [token]);

  const activeType = (form.type ?? "battery_low_any") as AlertRuleType;
  const typeConfig = alertTypeConfig[activeType];
  const params = (form.params ?? {}) as Record<string, unknown>;
  const eventsForView = useMemo(() => events.map((event) => normalizeEventForView(event)), [events]);
  const ruleTypeById = useMemo(() => {
    const map = new Map<string, AlertRuleType>();
    for (const rule of rules) map.set(rule.id, rule.type);
    return map;
  }, [rules]);

  const patchScope = useCallback((patch: Partial<AlertRule["scope"]>) => {
    setForm((prev) => ({ ...prev, scope: { ...(prev.scope ?? baseScope), ...patch } }));
  }, []);

  const patchNotifications = useCallback((patch: Partial<AlertRule["notifications"]>) => {
    setForm((prev) => ({ ...prev, notifications: { ...(prev.notifications ?? notificationDefaults), ...patch } }));
  }, []);

  const patchParams = useCallback((field: string, value: unknown) => {
    setForm((prev) => ({ ...prev, params: { ...(prev.params ?? {}), [field]: value } }));
  }, []);

  const resetFormForType = useCallback((type: AlertRuleType) => {
    const nextParams = { ...alertTypeConfig[type].defaults };
    setForm((prev) => ({ ...prev, type, params: nextParams }));
    setTestParamsText(JSON.stringify(nextParams, null, 2));
  }, []);

  useEffect(() => {
    setToken(window.localStorage.getItem("agent_admin_token") ?? "");
  }, []);

  useEffect(() => {
    setTestParamsText(JSON.stringify(form.params ?? {}, null, 2));
  }, [form.params, editingId]);

  const loadTenants = useCallback(async () => {
    if (!token) return;
    const resp = await fetch("/api/agent/v1/admin/tenants", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.detail ?? "Error cargando organizaciones");
    setDiscovery((prev) => ({ ...prev, tenants: Object.keys(data.items ?? {}) }));
  }, [token]);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [rulesRes, eventsRes, statusRes] = await Promise.all([
        fetch("/api/alerts/rules", { headers: authHeaders, cache: "no-store" }),
        fetch(`/api/alerts/events?status=${eventsStatusFilter}`, { headers: authHeaders, cache: "no-store" }),
        fetch("/api/alerts/status", { headers: authHeaders, cache: "no-store" }),
      ]);
      const [rulesData, eventsData, statusData] = await Promise.all([rulesRes.json(), eventsRes.json(), statusRes.json()]);
      if (!rulesRes.ok) throw new Error(rulesData.detail || "No se pudieron cargar las reglas");
      if (!eventsRes.ok) throw new Error(eventsData.detail || "No se pudieron cargar los eventos");
      if (!statusRes.ok) throw new Error(statusData.detail || "No se pudo cargar el estado del motor");
      setRules(rulesData.items ?? []);
      setEvents(eventsData.items ?? []);
      setStatus(statusData.item ?? null);
      await loadTenants();
      window.localStorage.setItem("agent_admin_token", token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, eventsStatusFilter, loadTenants, token]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const tenant = form.scope?.tenant;
    if (!tenant || !token) return;
    fetch(`/api/alerts/options/clients?tenant=${encodeURIComponent(tenant)}`, { headers: authHeaders, cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setDiscovery((prev) => ({ ...prev, clients: data.items ?? [], sites: [], serials: [], devices: [] })))
      .catch(() => setDiscovery((prev) => ({ ...prev, clients: [] })));
  }, [authHeaders, form.scope?.tenant, token]);

  useEffect(() => {
    const tenant = form.scope?.tenant;
    const client = form.scope?.client;
    if (!tenant || !client || !token) return;
    fetch(`/api/alerts/options/sites?tenant=${encodeURIComponent(tenant)}&client=${encodeURIComponent(client)}`, { headers: authHeaders, cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setDiscovery((prev) => ({ ...prev, sites: data.items ?? [], serials: [], devices: [] })))
      .catch(() => setDiscovery((prev) => ({ ...prev, sites: [] })));
  }, [authHeaders, form.scope?.client, form.scope?.tenant, token]);

  useEffect(() => {
    const tenant = form.scope?.tenant;
    const client = form.scope?.client;
    const site = form.scope?.site;
    if (!tenant || !client || !site || !token) return;
    Promise.all([
      fetch(`/api/alerts/options/serials?tenant=${encodeURIComponent(tenant)}&client=${encodeURIComponent(client)}&site=${encodeURIComponent(site)}`, { headers: authHeaders, cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/alerts/options/devices?tenant=${encodeURIComponent(tenant)}&client=${encodeURIComponent(client)}&site=${encodeURIComponent(site)}`, { headers: authHeaders, cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([serialsData, devicesData]) => setDiscovery((prev) => ({ ...prev, serials: serialsData.items ?? [], devices: devicesData.items ?? [] })))
      .catch(() => setDiscovery((prev) => ({ ...prev, serials: [], devices: [] })));
  }, [authHeaders, form.scope?.client, form.scope?.site, form.scope?.tenant, token]);

  const scopeSummary = useMemo(() => {
    const scope = form.scope;
    if (!scope) return [];
    return [scope.tenant, scope.client, scope.site, scope.serials?.length ? `${scope.serials.length} equipos` : ""].filter(Boolean) as string[];
  }, [form.scope]);

  const saveRule = useCallback(async () => {
    if (!token) {
      setError("Ingresa un token de administrador para guardar.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      let paramsFromEditor: Record<string, unknown> = {};
      try {
        paramsFromEditor = JSON.parse(testParamsText || "{}");
      } catch {
        throw new Error("JSON de prueba inválido. Corrige el bloque 'Flujo de prueba controlado' antes de guardar.");
      }
      const payload = {
        ...form,
        role: form.role,
        scope: {
          ...(form.scope ?? baseScope),
          role: form.role,
          serials: form.scope?.serials ?? [],
          deviceIds: form.scope?.deviceIds ?? [],
        },
        params: { ...(form.params ?? typeConfig.defaults), ...paramsFromEditor },
        notifications: {
          ...(form.notifications ?? notificationDefaults),
          groups: {
            client: form.notifications?.groups?.client ?? [],
            maintenance: form.notifications?.groups?.maintenance ?? [],
          },
        },
      } satisfies Partial<AlertRule>;

      const endpoint = editingId ? `/api/alerts/rules/${editingId}` : "/api/alerts/rules";
      const method = editingId ? "PUT" : "POST";
      const resp = await fetch(endpoint, { method, headers: authHeaders, body: JSON.stringify(payload) });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.detail ?? "No se pudo guardar la regla");
      setEditingId(null);
      const reset = { ...emptyRule, params: { ...alertTypeConfig.battery_low_any.defaults } };
      setForm(reset);
      setTestParamsText(JSON.stringify(reset.params ?? {}, null, 2));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error guardando la regla");
    } finally {
      setSaving(false);
    }
  }, [authHeaders, editingId, form, loadAll, testParamsText, token, typeConfig.defaults]);

  const testRule = useCallback(async (ruleId: string) => {
    if (!token) {
      setError("Ingresa un token de administrador para validar.");
      return;
    }
    setTestingRuleId(ruleId);
    setError("");
    setRunFeedback(null);
    try {
      let parsedParams: Record<string, unknown> = {};
      try {
        parsedParams = JSON.parse(testParamsText || "{}");
      } catch {
        throw new Error("JSON de prueba inválido. Corrige el formato antes de validar.");
      }
      const resp = await fetch(`/api/alerts/rules/${ruleId}/test`, { method: "POST", headers: authHeaders, body: JSON.stringify({ params: parsedParams }) });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.detail ?? "No se pudo validar la regla");
      setValidationResult(data?.result?.debug ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error ejecutando validación");
    } finally {
      setTestingRuleId(null);
    }
  }, [authHeaders, testParamsText, token]);

  const removeRule = useCallback(async (id: string) => {
    if (!token) return;
    setError("");
    const resp = await fetch(`/api/alerts/rules/${id}`, { method: "DELETE", headers: authHeaders });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setError(data?.detail ?? "No se pudo borrar la regla");
      return;
    }
    await loadAll();
  }, [authHeaders, loadAll, token]);

  const updateEventStatus = useCallback(async (eventId: string, action: "ack" | "resolve") => {
    if (!token) return;
    setError("");
    const resp = await fetch(`/api/alerts/events/${eventId}/${action}`, { method: "POST", headers: authHeaders });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setError(data?.detail ?? "No se pudo actualizar el evento");
      return;
    }
    await loadAll();
  }, [authHeaders, loadAll, token]);

  const deleteEvent = useCallback(async (eventId: string) => {
    if (!token) return;
    setError("");
    const resp = await fetch(`/api/alerts/events/${eventId}`, { method: "DELETE", headers: authHeaders });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setError(data?.detail ?? "No se pudo borrar el evento");
      return;
    }
    await loadAll();
  }, [authHeaders, loadAll, token]);

  const clearEvents = useCallback(async (status: "resolved" | "all") => {
    if (!token) return;
    setError("");
    const resp = await fetch(`/api/alerts/events?status=${status}`, { method: "DELETE", headers: authHeaders });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setError(data?.detail ?? "No se pudieron limpiar eventos");
      return;
    }
    await loadAll();
  }, [authHeaders, loadAll, token]);

  const runEvaluationNow = useCallback(async () => {
    if (!token) return;
    setRunningNow(true);
    setError("");
    setRunFeedback(null);
    try {
      const resp = await fetch("/api/alerts/run", { method: "POST", headers: authHeaders });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.detail ?? "No se pudo ejecutar el motor");
      setRunFeedback({
        evaluated: Number(data?.evaluated ?? 0),
        fired: Number(data?.fired ?? 0),
        ranAt: new Date().toISOString(),
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error ejecutando motor");
    } finally {
      setRunningNow(false);
    }
  }, [authHeaders, loadAll, token]);

  const applyMockPreset = useCallback((mode: "low" | "critical" | "ok") => {
    const presetBucket = typeMockPresets[activeType];
    const selected = mode === "critical" ? (presetBucket.critical ?? presetBucket.low) : presetBucket[mode];
    const preset = { ...alertTypeConfig[activeType].defaults, ...selected };
    setForm((prev) => ({ ...prev, params: { ...(prev.params ?? {}), ...preset } }));
    setTestParamsText(JSON.stringify({ ...(form.params ?? {}), ...preset }, null, 2));
  }, [activeType, form.params]);

  return (
    <section className="space-y-6 text-slate-100">
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 to-slate-950 p-5">
        <p className="text-xs uppercase tracking-wider text-cyan-300">Alertas</p>
        <h1 className="text-2xl font-semibold">Sistema de reglas y notificaciones</h1>
        <p className="mt-1 text-sm text-slate-300">Configura, prueba y opera alertas para equipos IoT de forma centralizada y escalable. Soporta modo mock y modo real para datos energéticos.</p>
      </div>

      <div className="rounded-2xl border border-amber-700/60 bg-amber-950/30 p-4 text-sm text-amber-100">
        <p className="font-semibold">Estado actual del módulo</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-200">
          <li>Fuente de datos configurable por regla: <code>mock</code> o <code>real</code>.</li>
          <li>Batería por voltaje (V) y porcentaje estimado (si aplica curva).</li>
          <li>Email: envío en modo preview (no entrega real), webhook sí intenta ejecución.</li>
          <li><b>Validar</b> = simulación manual, no persiste eventos.</li>
          <li><b>Ejecutar evaluación ahora</b> = ejecución real del motor, sí puede persistir eventos.</li>
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputClass} max-w-xl`} placeholder="Token administrador" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-500" onClick={loadAll}>Cargar</button>
        <Link href="/" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">Volver</Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ["rules", "Reglas"],
          ["events", "Eventos"],
          ["status", "Estado"],
        ].map(([key, label]) => (
          <button key={key} className={`rounded-lg px-4 py-2 text-sm ${tab === key ? "bg-cyan-700 text-white" : "bg-slate-800 text-slate-300"}`} onClick={() => setTab(key as typeof tab)}>
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="rounded-lg border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</p> : null}
      {loading ? <p className="rounded-lg border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-300">Cargando datos...</p> : null}

      {tab === "rules" ? (
        <div className="space-y-5">
          <SectionCard title="1) Datos generales" subtitle="Información base de la alerta que se mantiene independiente del tipo de regla.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <FieldBlock label="Nombre de la alerta">
                <input className={inputClass} placeholder="Ej: Batería baja en planta sur" value={form.name ?? ""} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              </FieldBlock>
              <FieldBlock label="Tipo de alerta">
                <select className={inputClass} value={activeType} onChange={(e) => resetFormForType(e.target.value as AlertRuleType)}>
                  {ALERT_RULE_TYPES.map((type) => <option key={type} value={type}>{alertTypeConfig[type].label}</option>)}
                </select>
                <p className="text-xs text-slate-400">{typeConfig.description}</p>
              </FieldBlock>
              <FieldBlock label="Severidad">
                <select className={inputClass} value={form.severity ?? "warn"} onChange={(e) => setForm((p) => ({ ...p, severity: e.target.value as AlertRule["severity"] }))}>
                  {ALERT_SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
                </select>
              </FieldBlock>
              <FieldBlock label="Cadencia de evaluación (min)">
                <input type="number" min={1} className={inputClass} value={Number(form.scheduleMinutes ?? 5)} onChange={(e) => setForm((p) => ({ ...p, scheduleMinutes: Number(e.target.value) }))} />
              </FieldBlock>
              <FieldBlock label="Fuente de datos">
                <select className={inputClass} value={form.dataSource ?? "mock"} onChange={(e) => setForm((p) => ({ ...p, dataSource: e.target.value as AlertRule["dataSource"] }))}>
                  {ALERT_DATA_SOURCES.map((source) => <option key={source} value={source}>{source === "mock" ? "Mock (simulación)" : "Real (telemetría)"}</option>)}
                </select>
              </FieldBlock>
            </div>
          </SectionCard>

          <SectionCard title="2) Alcance / scope" subtitle="Define dónde aplica la regla dentro de tu estructura operacional.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <FieldBlock label="Organización">
                <select className={inputClass} value={form.scope?.tenant ?? ""} onChange={(e) => patchScope({ tenant: e.target.value, client: undefined, site: undefined, serials: [], deviceIds: [] })}>
                  <option value="">Selecciona organización</option>
                  {discovery.tenants.map((tenant) => <option key={tenant} value={tenant}>{tenant}</option>)}
                </select>
              </FieldBlock>
              <FieldBlock label="Cliente">
                <select className={inputClass} value={form.scope?.client ?? ""} onChange={(e) => patchScope({ client: e.target.value || undefined, site: undefined, serials: [], deviceIds: [] })}>
                  <option value="">Selecciona cliente</option>
                  {discovery.clients.map((client) => <option key={client} value={client}>{client}</option>)}
                </select>
              </FieldBlock>
              <FieldBlock label="Ubicación">
                <select className={inputClass} value={form.scope?.site ?? ""} onChange={(e) => patchScope({ site: e.target.value || undefined, serials: [], deviceIds: [] })}>
                  <option value="">Selecciona ubicación</option>
                  {discovery.sites.map((site) => <option key={site} value={site}>{site}</option>)}
                </select>
              </FieldBlock>
              <FieldBlock label="Equipo / Gateway (opcional)">
                <select className={inputClass} value={form.scope?.serials?.[0] ?? ""} onChange={(e) => patchScope({ serials: e.target.value ? [e.target.value] : [], deviceIds: [] })}>
                  <option value="">Todos los equipos</option>
                  {discovery.serials.map((serial) => <option key={serial} value={serial}>{serial}</option>)}
                </select>
              </FieldBlock>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <FieldBlock label="Dispositivos afectados" help="Puedes seleccionar uno o varios dispositivos según el caso de negocio.">
                <select multiple className={`${inputClass} min-h-36`} value={form.scope?.deviceIds ?? []} onChange={(e) => patchScope({ deviceIds: Array.from(e.target.selectedOptions).map((opt) => opt.value) })}>
                  {discovery.devices.map((device) => <option key={device} value={device}>{device}</option>)}
                </select>
              </FieldBlock>
              <FieldBlock label="Modo de evaluación" help="Modo agrupada: Genera una sola alerta para todos los dispositivos afectados. Modo por dispositivo: Genera una alerta independiente por cada dispositivo afectado.">
                <select className={inputClass} value={form.scope?.mode ?? "grouped"} onChange={(e) => patchScope({ mode: e.target.value as AlertRule["scope"]["mode"] })}>
                  <option value="grouped">Modo agrupada</option>
                  <option value="per_device">Modo por dispositivo</option>
                </select>
              </FieldBlock>
              <FieldBlock label="Rol (opcional)">
                <select className={inputClass} value={form.role ?? ""} onChange={(e) => setForm((p) => ({ ...p, role: (e.target.value || undefined) as AlertRole | undefined }))}>
                  <option value="">Todos los roles</option>
                  {ALERT_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </FieldBlock>
            </div>
          </SectionCard>

          <SectionCard title="3) Parámetros de esta regla" subtitle="Configura aquí los parámetros concretos de este tipo de alerta.">
            {typeConfig.render({ params, onChange: patchParams })}
          </SectionCard>

          <SectionCard title="4) Flujo de prueba controlado" subtitle="En modo mock puedes inyectar datos para validar edge/level/cooldown de forma reproducible.">
            <div className="space-y-3">
              {form.dataSource === "real" ? (
                <p className="rounded-lg border border-cyan-800/50 bg-cyan-950/20 p-3 text-xs text-cyan-200">Esta regla usa telemetría real. El bloque JSON se mantiene para validar sin tocar producción, pero la ejecución del motor usará datos reales.</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button className="rounded-lg border border-amber-700 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-900/30" onClick={() => applyMockPreset("low")}>
                  Preset low ({typeConfig.label})
                </button>
                {activeType.startsWith("battery_voltage_") ? (
                  <button className="rounded-lg border border-red-700 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900/30" onClick={() => applyMockPreset("critical")}>
                    Preset critical
                  </button>
                ) : null}
                <button className="rounded-lg border border-emerald-700 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-900/30" onClick={() => applyMockPreset("ok")}>
                  Preset OK
                </button>
                <button className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800" onClick={() => setTestParamsText(JSON.stringify(form.params ?? {}, null, 2))}>
                  Restaurar desde formulario
                </button>
              </div>
              {activeType.startsWith("battery_voltage_") ? (
                <p className="text-xs text-cyan-300">Para reglas de voltaje en mock usa <code>mockBatteries[].voltage</code> por dispositivo (V). Ejemplo: 3.29, 3.19, 3.45.</p>
              ) : null}
              <textarea
                className={`${inputClass} min-h-40 font-mono text-xs`}
                value={testParamsText}
                onChange={(e) => setTestParamsText(e.target.value)}
                placeholder='{"mockValue": 120}'
              />
              <p className="text-xs text-slate-400">Este JSON se usa en “Validar (simulación)” sin sobrescribir la regla guardada. Para persistir eventos usa “Estado → Ejecutar evaluación ahora”. Si la regla está en modo real, este JSON solo afecta la simulación manual.</p>
            </div>
          </SectionCard>

          <SectionCard title="5) Notificaciones" subtitle="Define quién recibe alertas y cómo se controla la frecuencia de envío.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <FieldBlock label="Destinatarios directos" help="Correos separados por comas. Recibirán la alerta siempre.">
                <input className={inputClass} value={form.notifications?.emails?.join(", ") ?? ""} onChange={(e) => patchNotifications({ emails: csvToList(e.target.value) })} />
              </FieldBlock>
              <FieldBlock label="Correos del cliente" help="Grupo de destinatarios del cliente final.">
                <input className={inputClass} value={form.notifications?.groups?.client?.join(", ") ?? ""} onChange={(e) => patchNotifications({ groups: { client: csvToList(e.target.value), maintenance: form.notifications?.groups?.maintenance ?? [] } })} />
              </FieldBlock>
              <FieldBlock label="Correos de mantenimiento" help="Grupo de destinatarios técnicos o de mantenimiento.">
                <input className={inputClass} value={form.notifications?.groups?.maintenance?.join(", ") ?? ""} onChange={(e) => patchNotifications({ groups: { client: form.notifications?.groups?.client ?? [], maintenance: csvToList(e.target.value) } })} />
              </FieldBlock>
              <FieldBlock label="Webhook (opcional)" help="Se enviará una notificación HTTP POST cuando se dispare la alerta.">
                <input className={inputClass} placeholder="https://..." value={form.notifications?.webhookUrl ?? ""} onChange={(e) => patchNotifications({ webhookUrl: e.target.value || undefined })} />
              </FieldBlock>
              <FieldBlock label="Cuándo avisar" help="Solo cuando cambia: edge. Mientras siga activa: level.">
                <select className={inputClass} value={form.notifications?.triggerMode ?? "edge"} onChange={(e) => patchNotifications({ triggerMode: e.target.value as "edge" | "level" })}>
                  <option value="edge">Solo cuando cambia</option>
                  <option value="level">Mientras siga activa</option>
                </select>
              </FieldBlock>
              <FieldBlock label="Tiempo mínimo entre avisos" help="Evita avisos repetidos demasiado frecuentes.">
                <input type="number" min={1} className={inputClass} value={Number(form.notifications?.cooldownMinutes ?? 30)} onChange={(e) => patchNotifications({ cooldownMinutes: Number(e.target.value) })} />
              </FieldBlock>
            </div>
          </SectionCard>

          <SectionCard title="6) Resumen antes de guardar" subtitle="Verifica rápidamente el alcance y comportamiento de la alerta.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 text-sm">
              <p><span className="text-slate-400">Alcance:</span> {scopeSummary.join(" / ") || "Sin definir"}</p>
              <p><span className="text-slate-400">Tipo:</span> {typeConfig.label}</p>
              <p><span className="text-slate-400">Severidad:</span> {form.severity ?? "warn"}</p>
              <p><span className="text-slate-400">Modo:</span> {form.scope?.mode ?? "grouped"}</p>
              <p><span className="text-slate-400">Fuente:</span> {form.dataSource ?? "mock"}</p>
              <p><span className="text-slate-400">Parámetro principal:</span> {typeConfig.summary(params)}</p>
              <p><span className="text-slate-400">Destinatarios:</span> {(form.notifications?.emails?.length ?? 0) + (form.notifications?.groups?.client?.length ?? 0) + (form.notifications?.groups?.maintenance?.length ?? 0)} contactos</p>
            </div>
            <div className="mt-4 flex gap-2">
              <button disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60" onClick={saveRule}>{saving ? "Guardando..." : editingId ? "Actualizar regla" : "Guardar regla"}</button>
              {editingId ? <button className="rounded-lg border border-slate-700 px-4 py-2 text-sm" onClick={() => { setEditingId(null); setForm(emptyRule); setTestParamsText(JSON.stringify(emptyRule.params ?? {}, null, 2)); }}>Cancelar edición</button> : null}
            </div>
          </SectionCard>

          <SectionCard title="Reglas activas" subtitle="Listado de reglas creadas con lectura rápida de estado, severidad y alcance.">
            <p className="mb-3 rounded-lg border border-cyan-800/50 bg-cyan-950/20 px-3 py-2 text-xs text-cyan-100">
              Usa <b>Validar (simulación)</b> para comprobar lógica sin crear eventos reales. Para crear eventos persistidos usa <b>Estado → Ejecutar evaluación ahora</b>.
            </p>
            {rules.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">Todavía no hay reglas creadas para este entorno.</p>
            ) : (
              <div className="space-y-2">
                {rules.map((rule) => (
                  <div key={rule.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-100">{rule.name}</p>
                        <p className="text-xs text-slate-400">{rule.scope.tenant} / {rule.scope.client ?? "-"} / {rule.scope.site ?? "-"}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-cyan-900/60 px-2 py-1 text-cyan-200">{rule.type}</span>
                        <span className="rounded-full bg-violet-900/60 px-2 py-1 text-violet-200">{rule.scope.mode}</span>
                        <span className="rounded-full bg-amber-900/60 px-2 py-1 text-amber-200">{rule.severity}</span>
                        {isRuleUsingMockData(rule) ? <span className="rounded-full bg-orange-900/60 px-2 py-1 text-orange-200">mock-data</span> : <span className="rounded-full bg-emerald-900/60 px-2 py-1 text-emerald-200">real-data</span>}
                        <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-200">{rule.notifications.triggerMode} · cd {rule.notifications.cooldownMinutes}m</span>
                        <span className={`rounded-full px-2 py-1 ${rule.enabled ? "bg-emerald-900/60 text-emerald-200" : "bg-slate-800 text-slate-300"}`}>{rule.enabled ? "Activa" : "Pausada"}</span>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">Última ejecución: {rule.lastRunAt ?? "-"} · Resultado: {rule.lastResult?.message ?? "-"}</p>
                    <div className="mt-3 flex gap-2">
                      <button className="rounded-lg border border-cyan-700 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-900/30" onClick={() => testRule(rule.id)}>{testingRuleId === rule.id ? "Validando..." : "Validar (simulación)"}</button>
                      <button className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800" onClick={() => { setEditingId(rule.id); setForm(rule); setTestParamsText(JSON.stringify(rule.params ?? {}, null, 2)); }}>Editar</button>
                      <button className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900/40" onClick={() => removeRule(rule.id)}>Eliminar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      ) : null}

      {tab === "events" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-2">
              {[
                ["active", "Activos"],
                ["resolved", "Resueltos"],
                ["all", "Todos"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={`rounded-lg px-3 py-1.5 text-xs ${eventsStatusFilter === key ? "bg-cyan-700 text-white" : "border border-slate-700 text-slate-300 hover:bg-slate-800"}`}
                  onClick={() => setEventsStatusFilter(key as typeof eventsStatusFilter)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800" onClick={() => clearEvents("resolved")}>Limpiar resueltos (seguro)</button>
            <button className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900/40" onClick={() => clearEvents("all")}>Borrar todos los eventos</button>
          </div>
          {eventsForView.length === 0 ? <p className="rounded-lg border border-dashed border-slate-700 p-6 text-sm text-slate-400">Sin eventos para el filtro seleccionado.</p> : null}
          {eventsForView.map((event) => {
            const presentation = buildEventPresentation(event, ruleTypeById.get(event.ruleId));
            return (
              <div key={event.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{event.ruleName}</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className={`rounded-full px-2 py-1 ${eventStatusClass(event.status)}`}>{event.status}</span>
                    <span className="rounded-full bg-amber-900/60 px-2 py-1 text-amber-200">{event.severity}</span>
                    <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-200">{event.scope.mode}</span>
                  </div>
                </div>
                <p className="mt-1 text-sm text-slate-300">{presentation.headline}</p>
                <p className="text-xs text-slate-500">{event.timestamp} · {event.scope.tenant}/{event.scope.client ?? "-"}/{event.scope.site ?? "-"}</p>
                <p className="mt-1 text-xs text-slate-400">{presentation.subheadline} · Regla: {event.ruleId}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={event.status !== "active"} className="rounded-lg border border-blue-700 px-3 py-1.5 text-xs text-blue-200 disabled:opacity-50" onClick={() => updateEventStatus(event.id, "ack")}>Marcar ACK</button>
                  <button disabled={event.status === "resolved"} className="rounded-lg border border-emerald-700 px-3 py-1.5 text-xs text-emerald-200 disabled:opacity-50" onClick={() => updateEventStatus(event.id, "resolve")}>Marcar resuelto</button>
                  <button className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900/40" onClick={() => deleteEvent(event.id)}>Eliminar</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {tab === "status" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-xl border border-sky-800/60 bg-sky-950/20 p-4 md:col-span-2 xl:col-span-3">
            <p className="text-sm text-sky-100"><b>Ejecución real del motor:</b> este botón llama a <code>POST /api/alerts/run</code>, evalúa reglas activas y puede persistir eventos en la pestaña Eventos.</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-sm text-slate-400">Motor</p><p className="text-xl">{status?.engineStatus ?? "-"}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-sm text-slate-400">Última evaluación</p><p className="text-xl">{status?.lastRunAt ?? "-"}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-sm text-slate-400">Reglas evaluadas</p><p className="text-xl">{status?.rulesEvaluated ?? 0}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-sm text-slate-400">Tiempo medio</p><p className="text-xl">{status?.avgEvalMs ?? 0} ms</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-sm text-slate-400">Disparadas hoy</p><p className="text-xl">{status?.alertsTriggeredToday ?? 0}</p></div>
          <button disabled={runningNow} className="rounded-xl bg-blue-700 px-3 py-2 disabled:opacity-60" onClick={runEvaluationNow}>
            {runningNow ? "Ejecutando..." : "Ejecutar evaluación ahora"}
          </button>
          {runFeedback ? (
            <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/30 p-4 md:col-span-2 xl:col-span-3">
              <p className="text-sm text-emerald-100">
                Ejecución real completada ({runFeedback.ranAt}): <b>{runFeedback.evaluated}</b> regla(s) evaluada(s), <b>{runFeedback.fired}</b> disparada(s).
              </p>
              <button className="mt-2 rounded-lg border border-emerald-700 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-900/30" onClick={() => setTab("events")}>
                Ver eventos generados
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {validationResult ? <ValidationModal result={validationResult} onClose={() => setValidationResult(null)} /> : null}
    </section>
  );
}
