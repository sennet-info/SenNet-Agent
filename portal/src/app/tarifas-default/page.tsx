"use client";

import { useEffect, useMemo, useState } from "react";

import { adminGetPricingDefaults, adminPutPricingDefaults, PricingDefaults } from "@/lib/agent-api-client";

const EMPTY_DEFAULTS: PricingDefaults = {
  fallback: 0.14,
  scopes: { serial: {}, site: {}, client: {}, tenant: {} },
};

type Scope = "serial" | "site" | "client" | "tenant";

function parseScope(text: string): Record<string, number> {
  const entries: Array<[string, number]> = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [rawKey, rawValue] = trimmed.split("=").map((part) => part.trim());
    if (!rawKey || !rawValue) continue;
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric < 0) continue;
    entries.push([rawKey, numeric]);
  }
  return Object.fromEntries(entries);
}

function formatScope(scope: Record<string, number>) {
  return Object.entries(scope)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export default function TarifasDefaultPage() {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const [fallback, setFallback] = useState("0.14");
  const [scopeText, setScopeText] = useState<Record<Scope, string>>({
    tenant: "",
    client: "",
    site: "",
    serial: "",
  });

  useEffect(() => {
    setToken(window.localStorage.getItem("agent_admin_token") ?? "");
  }, []);

  const canSave = useMemo(() => Number.isFinite(Number(fallback)) && Number(fallback) >= 0, [fallback]);

  async function load() {
    if (!token) {
      setError("Introduce un token de administración.");
      return;
    }
    setLoading(true);
    setError("");
    setOk("");
    try {
      const response = await adminGetPricingDefaults(token);
      const item = response.item ?? EMPTY_DEFAULTS;
      setFallback(String(item.fallback));
      setScopeText({
        tenant: formatScope(item.scopes.tenant),
        client: formatScope(item.scopes.client),
        site: formatScope(item.scopes.site),
        serial: formatScope(item.scopes.serial),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las tarifas.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!token || !canSave) return;
    setSaving(true);
    setError("");
    setOk("");
    try {
      const payload: PricingDefaults = {
        fallback: Number(fallback),
        scopes: {
          tenant: parseScope(scopeText.tenant),
          client: parseScope(scopeText.client),
          site: parseScope(scopeText.site),
          serial: parseScope(scopeText.serial),
        },
      };
      await adminPutPricingDefaults(token, payload);
      setOk("Tarifas por defecto guardadas correctamente.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar las tarifas.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5">
      <h2 className="text-3xl font-semibold tracking-tight">Tarifas por defecto</h2>
      <p className="text-sm text-slate-300">Zona administrativa separada del flujo de informes. Jerarquía aplicada: serial → instalación → cliente → tenant → fallback global.</p>

      <div className="grid gap-3 md:grid-cols-3">
        <input value={token} onChange={(event) => setToken(event.target.value)} className="rounded border border-slate-700 bg-slate-950 p-2" placeholder="Token admin" />
        <button className="rounded bg-slate-700 px-4 py-2" onClick={load} disabled={loading || !token} type="button">{loading ? "Cargando..." : "Cargar"}</button>
        <button className="rounded bg-emerald-700 px-4 py-2" onClick={save} disabled={saving || !canSave || !token} type="button">{saving ? "Guardando..." : "Guardar cambios"}</button>
      </div>

      <div className="rounded border border-slate-800 p-4 space-y-3">
        <label className="block text-sm">Fallback global (€/kWh)</label>
        <input type="number" min={0} step="0.001" value={fallback} onChange={(event) => setFallback(event.target.value)} className="rounded border border-slate-700 bg-slate-950 p-2 max-w-xs" />
        <p className="text-xs text-slate-500">Formato por alcance: una línea por entrada usando <code>clave=precio</code>.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {(["tenant", "client", "site", "serial"] as Scope[]).map((scope) => (
          <div key={scope} className="rounded border border-slate-800 p-3 space-y-2">
            <p className="text-sm font-semibold">{scope}</p>
            <textarea
              value={scopeText[scope]}
              onChange={(event) => setScopeText((prev) => ({ ...prev, [scope]: event.target.value }))}
              className="h-36 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-sm"
              placeholder="ejemplo=0.142"
            />
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {ok && <p className="text-sm text-emerald-400">{ok}</p>}
    </section>
  );
}
