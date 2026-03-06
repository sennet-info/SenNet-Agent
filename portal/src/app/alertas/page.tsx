"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AlertEvent, AlertRule, AlertsState } from "@/lib/alerts-types";

const emptyRule: Partial<AlertRule> = {
  name: "",
  enabled: true,
  type: "heartbeat",
  severity: "warn",
  scope: { tenant: "" },
  params: { windowMinutes: 15 },
  scheduleMinutes: 5,
  notifications: { emails: [], triggerMode: "edge", cooldownMinutes: 30 },
};

export default function AlertasPage() {
  const [token, setToken] = useState("");
  const [tab, setTab] = useState<"rules" | "events" | "status">("rules");
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [status, setStatus] = useState<AlertsState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<Partial<AlertRule>>(emptyRule);
  const [editingId, setEditingId] = useState<string | null>(null);

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }), [token]);

  useEffect(() => {
    setToken(window.localStorage.getItem("agent_admin_token") ?? "");
  }, []);

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
      window.localStorage.setItem("agent_admin_token", token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function saveRule() {
    try {
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
    }
  }

  async function removeRule(id: string) {
    await fetch(`/api/alerts/rules/${id}`, { method: "DELETE", headers: authHeaders });
    await loadAll();
  }

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
        {[
          ["rules", "Reglas"],
          ["events", "Eventos"],
          ["status", "Estado"],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as never)} className={`rounded px-3 py-2 text-sm ${tab === key ? "bg-blue-700" : "bg-slate-800"}`}>
            {label}
          </button>
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
              <input placeholder="Tenant" className="rounded border border-slate-700 bg-slate-950 p-2" value={form.scope?.tenant ?? ""} onChange={(e) => setForm((p) => ({ ...p, scope: { ...(p.scope ?? { tenant: "" }), tenant: e.target.value } }))} />
              <input placeholder="Site" className="rounded border border-slate-700 bg-slate-950 p-2" value={form.scope?.site ?? ""} onChange={(e) => setForm((p) => ({ ...p, scope: { ...(p.scope ?? { tenant: "" }), site: e.target.value } }))} />
              <select className="rounded border border-slate-700 bg-slate-950 p-2" value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as AlertRule["type"] }))}>
                <option value="heartbeat">heartbeat/no_data</option><option value="threshold">threshold</option><option value="daily_sum">daily_sum</option><option value="battery_low">battery_low</option><option value="battery_low_all">battery_low_all</option>
              </select>
              <select className="rounded border border-slate-700 bg-slate-950 p-2" value={form.severity} onChange={(e) => setForm((p) => ({ ...p, severity: e.target.value as AlertRule["severity"] }))}>
                <option value="info">info</option><option value="warn">warn</option><option value="critical">critical</option>
              </select>
              <input type="number" placeholder="Cadencia min" className="rounded border border-slate-700 bg-slate-950 p-2" value={Number(form.scheduleMinutes ?? 5)} onChange={(e) => setForm((p) => ({ ...p, scheduleMinutes: Number(e.target.value) }))} />
              <input placeholder="Emails CSV" className="rounded border border-slate-700 bg-slate-950 p-2 md:col-span-2" value={form.notifications?.emails?.join(",") ?? ""} onChange={(e) => setForm((p) => ({ ...p, notifications: { ...(p.notifications ?? { emails: [], triggerMode: "edge", cooldownMinutes: 30 }), emails: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } }))} />
              <input placeholder="Webhook URL" className="rounded border border-slate-700 bg-slate-950 p-2" value={form.notifications?.webhookUrl ?? ""} onChange={(e) => setForm((p) => ({ ...p, notifications: { ...(p.notifications ?? { emails: [], triggerMode: "edge", cooldownMinutes: 30 }), webhookUrl: e.target.value } }))} />
            </div>
            <div className="mt-3 flex gap-2">
              <button className="rounded bg-green-700 px-3 py-2" onClick={saveRule}>Guardar</button>
              {editingId && <button className="rounded bg-slate-700 px-3 py-2" onClick={() => { setEditingId(null); setForm(emptyRule); }}>Cancelar</button>}
            </div>
          </div>

          {rules.length === 0 ? <p className="rounded border border-dashed border-slate-700 p-6 text-sm text-slate-400">Aún no hay reglas.</p> : (
            <div className="overflow-x-auto rounded border border-slate-800">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-900"><tr><th className="p-2 text-left">Nombre</th><th>Scope</th><th>Tipo</th><th>Severidad</th><th>Enabled</th><th>Última ejecución</th><th>Último resultado</th><th>Último disparo</th><th>Acciones</th></tr></thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} className="border-t border-slate-800"><td className="p-2">{rule.name}</td><td>{rule.scope.tenant}/{rule.scope.site ?? "-"}</td><td>{rule.type}</td><td>{rule.severity}</td><td>{rule.enabled ? "Sí" : "No"}</td><td>{rule.lastRunAt ?? "-"}</td><td>{rule.lastResult?.message ?? "-"}</td><td>{rule.lastTriggeredAt ?? "-"}</td><td className="space-x-1 p-2"><button className="rounded bg-slate-700 px-2 py-1" onClick={() => { setEditingId(rule.id); setForm(rule); }}>Editar</button><button className="rounded bg-slate-700 px-2 py-1" onClick={() => setForm({ ...rule, id: undefined, name: `${rule.name} (copia)` })}>Duplicar</button><button className="rounded bg-red-700 px-2 py-1" onClick={() => removeRule(rule.id)}>Borrar</button></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "events" && (events.length === 0 ? <p className="rounded border border-dashed border-slate-700 p-6 text-sm text-slate-400">Sin eventos aún.</p> : (
        <div className="space-y-2">{events.map((event) => <div key={event.id} className="rounded border border-slate-800 p-3"><div className="flex justify-between"><p className="font-medium">{event.ruleName}</p><span className="text-xs">{event.severity}</span></div><p className="text-sm text-slate-300">{event.message}</p><p className="text-xs text-slate-500">{event.timestamp} · {event.scope.tenant}/{event.scope.site ?? "-"}</p></div>)}</div>
      ))}

      {tab === "status" && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded border border-slate-800 p-4"><p className="text-sm text-slate-400">Motor</p><p className="text-xl">{status?.engineStatus ?? "-"}</p></div>
          <div className="rounded border border-slate-800 p-4"><p className="text-sm text-slate-400">Última evaluación</p><p className="text-xl">{status?.lastRunAt ?? "-"}</p></div>
          <div className="rounded border border-slate-800 p-4"><p className="text-sm text-slate-400">Reglas evaluadas</p><p className="text-xl">{status?.rulesEvaluated ?? 0}</p></div>
          <div className="rounded border border-slate-800 p-4"><p className="text-sm text-slate-400">Tiempo medio</p><p className="text-xl">{status?.avgEvalMs ?? 0} ms</p></div>
          <div className="rounded border border-slate-800 p-4"><p className="text-sm text-slate-400">Disparadas hoy</p><p className="text-xl">{status?.alertsTriggeredToday ?? 0}</p></div>
          <div className="rounded border border-slate-800 p-4"><p className="text-sm text-slate-400">Último error</p><p className="text-xl">{status?.lastError ?? "-"}</p></div>
          <button className="rounded bg-blue-700 px-3 py-2" onClick={async () => { await fetch("/api/alerts/run", { method: "POST", headers: authHeaders }); await loadAll(); }}>Ejecutar evaluación ahora</button>
        </div>
      )}
    </section>
  );
}
