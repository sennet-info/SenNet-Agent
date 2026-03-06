"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AlertEvent, AlertRole, AlertRule, AlertsState } from "@/lib/alerts-types";

type DiscoveryState = {
  tenants: string[];
  clients: string[];
  sites: string[];
  serials: string[];
  devices: string[];
};

const emptyRule: Partial<AlertRule> = {
  name: "",
  enabled: true,
  type: "battery_low_any",
  severity: "warn",
  scope: { tenant: "", mode: "grouped", serials: [], deviceIds: [] },
  params: { threshold: 20, mockBatteries: [] },
  scheduleMinutes: 5,
  notifications: { emails: [], groups: { client: [], maintenance: [] }, triggerMode: "edge", cooldownMinutes: 30 },
};

function csvToList(input: string) {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

  useEffect(() => {
    setToken(window.localStorage.getItem("agent_admin_token") ?? "");
  }, []);

  const loadTenants = useCallback(async () => {
    if (!token) return;
    const resp = await fetch("/api/agent/v1/admin/tenants", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.detail ?? "Error cargando tenants");
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
      if (!rulesRes.ok) throw new Error(rulesData.detail || "Error cargando reglas");
      if (!eventsRes.ok) throw new Error(eventsData.detail || "Error cargando eventos");
      if (!statusRes.ok) throw new Error(statusData.detail || "Error cargando estado");
      setRules(rulesData.items ?? []);
      setEvents(eventsData.items ?? []);
      setStatus(statusData.item ?? null);
      await loadTenants();
      window.localStorage.setItem("agent_admin_token", token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
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

  useEffect(() => {
    const tenant = form.scope?.tenant;
    const client = form.scope?.client;
    const site = form.scope?.site;
    const serial = form.scope?.serials?.[0];
    if (!tenant || !client || !site || !serial || !token) return;
    fetch(`/api/alerts/options/devices?tenant=${encodeURIComponent(tenant)}&client=${encodeURIComponent(client)}&site=${encodeURIComponent(site)}&serial=${encodeURIComponent(serial)}`, {
      headers: authHeaders,
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data) => setDiscovery((prev) => ({ ...prev, devices: data.items ?? [] })))
      .catch(() => setDiscovery((prev) => ({ ...prev, devices: [] })));
  }, [authHeaders, form.scope?.client, form.scope?.serials, form.scope?.site, form.scope?.tenant, token]);

  async function saveRule() {
    setSaving(true);
    setError("");
    try {
      if (!form.name?.trim()) throw new Error("Nombre requerido");
      if (!form.scope?.tenant) throw new Error("Selecciona tenant");
      const url = editingId ? `/api/alerts/rules/${editingId}` : "/api/alerts/rules";
      const method = editingId ? "PUT" : "POST";
      const resp = await fetch(url, { method, headers: authHeaders, body: JSON.stringify(form) });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "No se pudo guardar");
      setForm(emptyRule);
      setEditingId(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function removeRule(id: string) {
    await fetch(`/api/alerts/rules/${id}`, { method: "DELETE", headers: authHeaders });
    await loadAll();
  }

  const scopeSummary = [form.scope?.tenant, form.scope?.client, form.scope?.site, form.scope?.serials?.join(",")].filter(Boolean);

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">Inicio / Alertas / {tab === "rules" ? "Reglas" : tab === "events" ? "Eventos" : "Estado"}</p>
          <h2 className="text-3xl font-semibold tracking-tight">Alertas</h2>
        </div>
        <Link href="/" className="rounded border border-slate-700 px-3 py-2 text-sm">Volver a inicio</Link>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <label className="mb-2 block text-sm text-slate-300">Token admin</label>
        <div className="flex gap-2">
          <input className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2" value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="rounded bg-blue-700 px-3 py-2" onClick={loadAll}>Cargar</button>
        </div>
      </div>

      <div className="flex gap-2">
        {[ ["rules", "Reglas"], ["events", "Eventos"], ["status", "Estado"] ].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as never)} className={`rounded px-3 py-2 text-sm ${tab === key ? "bg-blue-700" : "bg-slate-800"}`}>{label}</button>
        ))}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Cargando...</p>}

      {tab === "rules" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-800 p-4">
            <h3 className="mb-3 font-medium">{editingId ? "Editar regla" : "Nueva regla"}</h3>
            <div className="grid gap-2 md:grid-cols-3">
              <input placeholder="Nombre" className="rounded border border-slate-700 bg-slate-950 p-2" value={form.name ?? ""} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              <select className="rounded border border-slate-700 bg-slate-950 p-2" value={form.scope?.tenant ?? ""} onChange={(e) => setForm((p) => ({ ...p, scope: { tenant: e.target.value, mode: p.scope?.mode ?? "grouped", serials: [], deviceIds: [] } }))}>
                <option value="">Tenant...</option>{discovery.tenants.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className="rounded border border-slate-700 bg-slate-950 p-2" value={form.scope?.client ?? ""} onChange={(e) => setForm((p) => ({ ...p, scope: { ...(p.scope ?? { tenant: "", mode: "grouped" }), client: e.target.value, site: undefined, serials: [], deviceIds: [] } }))}>
                <option value="">Client...</option>{discovery.clients.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className="rounded border border-slate-700 bg-slate-950 p-2" value={form.scope?.site ?? ""} onChange={(e) => setForm((p) => ({ ...p, scope: { ...(p.scope ?? { tenant: "", mode: "grouped" }), site: e.target.value, serials: [], deviceIds: [] } }))}>
                <option value="">Site...</option>{discovery.sites.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className="rounded border border-slate-700 bg-slate-950 p-2" value={form.scope?.serials?.[0] ?? ""} onChange={(e) => setForm((p) => ({ ...p, scope: { ...(p.scope ?? { tenant: "", mode: "grouped" }), serials: e.target.value ? [e.target.value] : [], deviceIds: [] } }))}>
                <option value="">Serial (opcional)</option>{discovery.serials.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select multiple className="rounded border border-slate-700 bg-slate-950 p-2 h-28" value={form.scope?.deviceIds ?? []} onChange={(e) => setForm((p) => ({ ...p, scope: { ...(p.scope ?? { tenant: "", mode: "grouped" }), deviceIds: Array.from(e.target.selectedOptions).map((x) => x.value) } }))}>
                {discovery.devices.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className="rounded border border-slate-700 bg-slate-950 p-2" value={form.scope?.mode ?? "grouped"} onChange={(e) => setForm((p) => ({ ...p, scope: { ...(p.scope ?? { tenant: "" }), mode: e.target.value as "grouped" | "per_device" } }))}>
                <option value="per_device">Modo: por dispositivo</option><option value="grouped">Modo: agrupada</option>
              </select>
              <select className="rounded border border-slate-700 bg-slate-950 p-2" value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as AlertRule["type"] }))}>
                <option value="heartbeat">heartbeat/no_data</option><option value="threshold">threshold</option><option value="daily_sum">daily_sum</option><option value="battery_low_any">battery_low_any</option><option value="battery_low_all">battery_low_all</option>
              </select>
              <select className="rounded border border-slate-700 bg-slate-950 p-2" value={form.severity} onChange={(e) => setForm((p) => ({ ...p, severity: e.target.value as AlertRule["severity"] }))}>
                <option value="info">info</option><option value="warn">warn</option><option value="critical">critical</option>
              </select>
              <select className="rounded border border-slate-700 bg-slate-950 p-2" value={form.role ?? ""} onChange={(e) => setForm((p) => ({ ...p, role: (e.target.value || undefined) as AlertRole | undefined, scope: { ...(p.scope ?? { tenant: "", mode: "grouped" }), role: (e.target.value || undefined) as AlertRole | undefined } }))}>
                <option value="">Rol (opcional)</option><option value="consumption">consumption</option><option value="generation">generation</option><option value="storage">storage</option><option value="grid">grid</option><option value="environment">environment</option><option value="unknown">unknown</option>
              </select>
              <input type="number" placeholder="Umbral batería %" className="rounded border border-slate-700 bg-slate-950 p-2" value={Number((form.params as Record<string, unknown> | undefined)?.threshold ?? 20)} onChange={(e) => setForm((p) => ({ ...p, params: { ...(p.params ?? {}), threshold: Number(e.target.value) } }))} />
              <input type="number" placeholder="Cadencia min" className="rounded border border-slate-700 bg-slate-950 p-2" value={Number(form.scheduleMinutes ?? 5)} onChange={(e) => setForm((p) => ({ ...p, scheduleMinutes: Number(e.target.value) }))} />
              <input placeholder="Emails CSV" className="rounded border border-slate-700 bg-slate-950 p-2" value={form.notifications?.emails?.join(",") ?? ""} onChange={(e) => setForm((p) => ({ ...p, notifications: { ...(p.notifications ?? { emails: [], triggerMode: "edge", cooldownMinutes: 30 }), emails: csvToList(e.target.value) } }))} />
              <input placeholder="Grupo Cliente (emails CSV)" className="rounded border border-slate-700 bg-slate-950 p-2" value={form.notifications?.groups?.client?.join(",") ?? ""} onChange={(e) => setForm((p) => ({ ...p, notifications: { ...(p.notifications ?? { emails: [], triggerMode: "edge", cooldownMinutes: 30 }), groups: { client: csvToList(e.target.value), maintenance: p.notifications?.groups?.maintenance ?? [] } } }))} />
              <input placeholder="Grupo Mantenimiento (emails CSV)" className="rounded border border-slate-700 bg-slate-950 p-2" value={form.notifications?.groups?.maintenance?.join(",") ?? ""} onChange={(e) => setForm((p) => ({ ...p, notifications: { ...(p.notifications ?? { emails: [], triggerMode: "edge", cooldownMinutes: 30 }), groups: { client: p.notifications?.groups?.client ?? [], maintenance: csvToList(e.target.value) } } }))} />
              <input placeholder="Webhook URL" className="rounded border border-slate-700 bg-slate-950 p-2" value={form.notifications?.webhookUrl ?? ""} onChange={(e) => setForm((p) => ({ ...p, notifications: { ...(p.notifications ?? { emails: [], triggerMode: "edge", cooldownMinutes: 30 }), webhookUrl: e.target.value } }))} />
              <select className="rounded border border-slate-700 bg-slate-950 p-2" value={form.notifications?.triggerMode ?? "edge"} onChange={(e) => setForm((p) => ({ ...p, notifications: { ...(p.notifications ?? { emails: [], triggerMode: "edge", cooldownMinutes: 30 }), triggerMode: e.target.value as "edge" | "level" } }))}>
                <option value="edge">triggerMode=edge</option><option value="level">triggerMode=level</option>
              </select>
              <input type="number" placeholder="cooldownMinutes" className="rounded border border-slate-700 bg-slate-950 p-2" value={Number(form.notifications?.cooldownMinutes ?? 30)} onChange={(e) => setForm((p) => ({ ...p, notifications: { ...(p.notifications ?? { emails: [], triggerMode: "edge", cooldownMinutes: 30 }), cooldownMinutes: Number(e.target.value) } }))} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
              {scopeSummary.length ? scopeSummary.map((item) => <span key={item as string} className="rounded bg-slate-800 px-2 py-1">{item}</span>) : <span className="text-slate-500">Sin scope seleccionado</span>}
              <span className="rounded bg-slate-800 px-2 py-1">{form.scope?.deviceIds?.length ?? 0} devices</span>
            </div>
            <div className="mt-3 flex gap-2">
              <button disabled={saving} className="rounded bg-green-700 px-3 py-2 disabled:opacity-60" onClick={saveRule}>{saving ? "Guardando..." : "Guardar"}</button>
              {editingId && <button className="rounded bg-slate-700 px-3 py-2" onClick={() => { setEditingId(null); setForm(emptyRule); }}>Cancelar</button>}
            </div>
          </div>

          {rules.length === 0 ? <p className="rounded border border-dashed border-slate-700 p-6 text-sm text-slate-400">Aún no hay reglas.</p> : (
            <div className="overflow-x-auto rounded border border-slate-800">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-900"><tr><th className="p-2 text-left">Nombre</th><th>Scope</th><th>Tipo</th><th>Modo</th><th>Última ejecución</th><th>Último resultado</th><th>Acciones</th></tr></thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} className="border-t border-slate-800"><td className="p-2">{rule.name}</td><td>{rule.scope.tenant}/{rule.scope.client ?? "-"}/{rule.scope.site ?? "-"}</td><td>{rule.type}</td><td>{rule.scope.mode}</td><td>{rule.lastRunAt ?? "-"}</td><td>{rule.lastResult?.message ?? "-"}</td><td className="space-x-1 p-2"><button className="rounded bg-slate-700 px-2 py-1" onClick={() => { setEditingId(rule.id); setForm(rule); }}>Editar</button><button className="rounded bg-red-700 px-2 py-1" onClick={() => removeRule(rule.id)}>Borrar</button></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "events" && (events.length === 0 ? <p className="rounded border border-dashed border-slate-700 p-6 text-sm text-slate-400">Sin eventos aún.</p> : (
        <div className="space-y-2">{events.map((event) => <div key={event.id} className="rounded border border-slate-800 p-3"><div className="flex justify-between"><p className="font-medium">{event.ruleName}</p><span className="text-xs">{event.severity}</span></div><p className="text-sm text-slate-300">{event.message}</p><p className="text-xs text-slate-500">{event.timestamp} · {event.scope.tenant}/{event.scope.client ?? "-"}/{event.scope.site ?? "-"}</p><p className="text-xs text-slate-400">Afectados: {event.affected?.map((a) => a.label ?? a.deviceId ?? a.serial).join(", ") || "-"}</p></div>)}</div>
      ))}

      {tab === "status" && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded border border-slate-800 p-4"><p className="text-sm text-slate-400">Motor</p><p className="text-xl">{status?.engineStatus ?? "-"}</p></div>
          <div className="rounded border border-slate-800 p-4"><p className="text-sm text-slate-400">Última evaluación</p><p className="text-xl">{status?.lastRunAt ?? "-"}</p></div>
          <div className="rounded border border-slate-800 p-4"><p className="text-sm text-slate-400">Reglas evaluadas</p><p className="text-xl">{status?.rulesEvaluated ?? 0}</p></div>
          <div className="rounded border border-slate-800 p-4"><p className="text-sm text-slate-400">Tiempo medio</p><p className="text-xl">{status?.avgEvalMs ?? 0} ms</p></div>
          <div className="rounded border border-slate-800 p-4"><p className="text-sm text-slate-400">Disparadas hoy</p><p className="text-xl">{status?.alertsTriggeredToday ?? 0}</p></div>
          <button className="rounded bg-blue-700 px-3 py-2" onClick={async () => { await fetch("/api/alerts/run", { method: "POST", headers: authHeaders }); await loadAll(); }}>Ejecutar evaluación ahora</button>
        </div>
      )}
    </section>
  );
}
