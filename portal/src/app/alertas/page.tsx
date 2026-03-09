"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ALERT_ROLES,
  ALERT_RULE_TYPES,
  ALERT_SEVERITIES,
  AlertEvent,
  AlertRole,
  AlertRule,
  AlertRuleType,
  AlertsState,
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
    defaults: { minutesWithoutData: 15 },
    summary: (params) => `Minutos sin datos: ${Number(params.minutesWithoutData ?? 15)}`,
    render: ({ params, onChange }) => (
      <FieldBlock label="Minutos sin datos" help="Si el dispositivo no reporta durante este tiempo, se dispara la alerta.">
        <input type="number" min={1} className={inputClass} value={Number(params.minutesWithoutData ?? 15)} onChange={(e) => onChange("minutesWithoutData", Number(e.target.value))} />
      </FieldBlock>
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

export default function AlertasPage() {
  const [token, setToken] = useState("");
  const [tab, setTab] = useState<"rules" | "events" | "status">("rules");
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [status, setStatus] = useState<AlertsState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<AlertRule>>(emptyRule);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryState>({ tenants: [], clients: [], sites: [], serials: [], devices: [] });

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }), [token]);

  const activeType = (form.type ?? "battery_low_any") as AlertRuleType;
  const typeConfig = alertTypeConfig[activeType];
  const params = (form.params ?? {}) as Record<string, unknown>;

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
    setForm((prev) => ({ ...prev, type, params: { ...alertTypeConfig[type].defaults } }));
  }, []);

  useEffect(() => {
    setToken(window.localStorage.getItem("agent_admin_token") ?? "");
  }, []);

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
        fetch("/api/alerts/events", { headers: authHeaders, cache: "no-store" }),
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
  }, [authHeaders, loadTenants, token]);

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
      const payload = {
        ...form,
        role: form.role,
        scope: {
          ...(form.scope ?? baseScope),
          role: form.role,
          serials: form.scope?.serials ?? [],
          deviceIds: form.scope?.deviceIds ?? [],
        },
        params: form.params ?? typeConfig.defaults,
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
      setForm({ ...emptyRule, params: { ...alertTypeConfig.battery_low_any.defaults } });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error guardando la regla");
    } finally {
      setSaving(false);
    }
  }, [authHeaders, editingId, form, loadAll, token, typeConfig.defaults]);

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

  return (
    <section className="space-y-6 text-slate-100">
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 to-slate-950 p-5">
        <p className="text-xs uppercase tracking-wider text-cyan-300">Alertas</p>
        <h1 className="text-2xl font-semibold">Sistema de reglas y notificaciones</h1>
        <p className="mt-1 text-sm text-slate-300">Configura, prueba y opera alertas para equipos IoT de forma centralizada y escalable.</p>
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

          <SectionCard title="4) Notificaciones" subtitle="Define quién recibe alertas y cómo se controla la frecuencia de envío.">
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

          <SectionCard title="5) Resumen antes de guardar" subtitle="Verifica rápidamente el alcance y comportamiento de la alerta.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 text-sm">
              <p><span className="text-slate-400">Alcance:</span> {scopeSummary.join(" / ") || "Sin definir"}</p>
              <p><span className="text-slate-400">Tipo:</span> {typeConfig.label}</p>
              <p><span className="text-slate-400">Severidad:</span> {form.severity ?? "warn"}</p>
              <p><span className="text-slate-400">Modo:</span> {form.scope?.mode ?? "grouped"}</p>
              <p><span className="text-slate-400">Parámetro principal:</span> {typeConfig.summary(params)}</p>
              <p><span className="text-slate-400">Destinatarios:</span> {(form.notifications?.emails?.length ?? 0) + (form.notifications?.groups?.client?.length ?? 0) + (form.notifications?.groups?.maintenance?.length ?? 0)} contactos</p>
            </div>
            <div className="mt-4 flex gap-2">
              <button disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60" onClick={saveRule}>{saving ? "Guardando..." : editingId ? "Actualizar regla" : "Guardar regla"}</button>
              {editingId ? <button className="rounded-lg border border-slate-700 px-4 py-2 text-sm" onClick={() => { setEditingId(null); setForm(emptyRule); }}>Cancelar edición</button> : null}
            </div>
          </SectionCard>

          <SectionCard title="Reglas activas" subtitle="Listado de reglas creadas con lectura rápida de estado, severidad y alcance.">
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
                        <span className={`rounded-full px-2 py-1 ${rule.enabled ? "bg-emerald-900/60 text-emerald-200" : "bg-slate-800 text-slate-300"}`}>{rule.enabled ? "Activa" : "Pausada"}</span>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">Última ejecución: {rule.lastRunAt ?? "-"} · Resultado: {rule.lastResult?.message ?? "-"}</p>
                    <div className="mt-3 flex gap-2">
                      <button className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800" onClick={() => { setEditingId(rule.id); setForm(rule); }}>Editar</button>
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
        events.length === 0 ? <p className="rounded-lg border border-dashed border-slate-700 p-6 text-sm text-slate-400">Sin eventos aún.</p> : (
          <div className="space-y-2">
            {events.map((event) => (
              <div key={event.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{event.ruleName}</p>
                  <span className="rounded-full bg-amber-900/60 px-2 py-1 text-xs text-amber-200">{event.severity}</span>
                </div>
                <p className="mt-1 text-sm text-slate-300">{event.message}</p>
                <p className="text-xs text-slate-500">{event.timestamp} · {event.scope.tenant}/{event.scope.client ?? "-"}/{event.scope.site ?? "-"}</p>
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === "status" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-sm text-slate-400">Motor</p><p className="text-xl">{status?.engineStatus ?? "-"}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-sm text-slate-400">Última evaluación</p><p className="text-xl">{status?.lastRunAt ?? "-"}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-sm text-slate-400">Reglas evaluadas</p><p className="text-xl">{status?.rulesEvaluated ?? 0}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-sm text-slate-400">Tiempo medio</p><p className="text-xl">{status?.avgEvalMs ?? 0} ms</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-sm text-slate-400">Disparadas hoy</p><p className="text-xl">{status?.alertsTriggeredToday ?? 0}</p></div>
          <button className="rounded-xl bg-blue-700 px-3 py-2" onClick={async () => { await fetch("/api/alerts/run", { method: "POST", headers: authHeaders }); await loadAll(); }}>Ejecutar evaluación ahora</button>
        </div>
      ) : null}
    </section>
  );
}
