"use client";

import { useEffect, useMemo, useState } from "react";

import {
  adminListTenants,
  createReport,
  discoveryClients,
  discoveryDevices,
  discoverySerials,
  discoverySites,
  downloadDebugUrl,
  downloadUrl,
  ReportResult,
} from "@/lib/agent-api-client";

function toIsoAtStart(dateValue: string) {
  return `${dateValue}T00:00:00`;
}

function toIsoAtEnd(dateValue: string) {
  return `${dateValue}T23:59:59`;
}

export default function InformesPage() {
  const [tenant, setTenant] = useState("");
  const [clients, setClients] = useState<string[]>([]);
  const [client, setClient] = useState("");
  const [sites, setSites] = useState<string[]>([]);
  const [site, setSite] = useState("");
  const [serials, setSerials] = useState<string[]>([]);
  const [serial, setSerial] = useState("");
  const [devices, setDevices] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [rangeMode, setRangeMode] = useState("last_days");
  const [lastDays, setLastDays] = useState(7);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [price, setPrice] = useState(0.14);
  const [workers] = useState(1);
  const [forceRecalculate] = useState(false);
  const [debug, setDebug] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReportResult | null>(null);

  useEffect(() => {
    const token = window.localStorage.getItem("agent_admin_token") ?? "";
    if (!token) return;
    adminListTenants(token)
      .then((resp) => {
        const first = Object.keys(resp.items)[0] ?? "";
        setTenant(first);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!tenant) return;
    discoveryClients(tenant).then((resp) => {
      setClients(resp.items);
      setClient(resp.items[0] ?? "");
    });
  }, [tenant]);

  useEffect(() => {
    if (!tenant || !client) return;
    discoverySites(tenant, client).then((resp) => {
      setSites(resp.items);
      setSite(resp.items[0] ?? "");
    });
  }, [tenant, client]);

  useEffect(() => {
    if (!tenant || !client || !site) return;
    discoverySerials(tenant, client, site).then((resp) => {
      setSerials(resp.items);
      setSerial("");
    });
    discoveryDevices(tenant, client, site).then((resp) => {
      setDevices(resp.items);
      setSelected(resp.items.filter((item) => item.toUpperCase().includes("GENERAL")));
    });
  }, [tenant, client, site]);

  useEffect(() => {
    if (!tenant || !client || !site || !serial) return;
    discoveryDevices(tenant, client, site, serial).then((resp) => {
      setDevices(resp.items);
      setSelected(resp.items.filter((item) => item.toUpperCase().includes("GENERAL")));
    });
  }, [tenant, client, site, serial]);

  const rangePayload = useMemo(() => {
    if (rangeMode === "last_days") {
      return { range_flux: `${lastDays}d` };
    }
    if (rangeMode === "full_month") {
      return { range_flux: "month" };
    }
    return {
      range_flux: "custom",
      start_dt: customStart ? toIsoAtStart(customStart) : undefined,
      end_dt: customEnd ? toIsoAtEnd(customEnd) : undefined,
    };
  }, [rangeMode, lastDays, customStart, customEnd]);

  async function generateReport() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const report = await createReport({
        tenant,
        client,
        site,
        serial: serial || undefined,
        devices: selected,
        price,
        max_workers: workers,
        force_recalculate: forceRecalculate,
        debug,
        ...rangePayload,
      });
      setResult(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-5">
      <h2 className="text-3xl font-semibold tracking-tight">Informes</h2>

      <div className="grid gap-2 md:grid-cols-4">
        <input value={tenant} onChange={(event) => setTenant(event.target.value)} className="rounded border border-slate-700 bg-slate-950 p-2" placeholder="Tenant" />
        <select value={client} onChange={(event) => setClient(event.target.value)} className="rounded border border-slate-700 bg-slate-950 p-2">
          {clients.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select value={site} onChange={(event) => setSite(event.target.value)} className="rounded border border-slate-700 bg-slate-950 p-2">
          {sites.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select value={serial} onChange={(event) => setSerial(event.target.value)} className="rounded border border-slate-700 bg-slate-950 p-2">
          <option value="">Todos los seriales</option>
          {serials.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>

      <div className="rounded border border-slate-800 p-3">
        <div className="mb-2 flex gap-2">
          <button className="rounded bg-slate-700 px-2 py-1" onClick={() => setSelected(devices)} type="button">Todos</button>
          <button className="rounded bg-slate-700 px-2 py-1" onClick={() => setSelected([])} type="button">Nada</button>
          <button className="rounded bg-slate-700 px-2 py-1" onClick={() => setSelected(devices.filter((d) => d.toUpperCase().includes("GENERAL")))} type="button">General</button>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {devices.map((device) => (
            <label key={device} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(device)}
                onChange={(event) =>
                  setSelected((prev) =>
                    event.target.checked ? [...prev, device] : prev.filter((item) => item !== device),
                  )
                }
              />
              {device}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <select value={rangeMode} onChange={(event) => setRangeMode(event.target.value)} className="rounded border border-slate-700 bg-slate-950 p-2">
          <option value="last_days">Últimos días</option>
          <option value="full_month">Mes completo</option>
          <option value="custom">Personalizado</option>
        </select>
        <input type="number" value={lastDays} onChange={(event) => setLastDays(Number(event.target.value))} disabled={rangeMode !== "last_days"} className="rounded border border-slate-700 bg-slate-950 p-2" />
        <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} disabled={rangeMode !== "custom"} className="rounded border border-slate-700 bg-slate-950 p-2" />
        <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} disabled={rangeMode !== "custom"} className="rounded border border-slate-700 bg-slate-950 p-2" />
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <input type="number" value={price} onChange={(event) => setPrice(Number(event.target.value))} className="rounded border border-slate-700 bg-slate-950 p-2" />
        <input type="number" value={workers} disabled className="rounded border border-slate-700 bg-slate-950 p-2 opacity-60" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded bg-emerald-700 px-4 py-2" disabled={loading || selected.length === 0} onClick={generateReport} type="button">
          {loading ? "Generando..." : "Generar"}
        </button>

        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={debug} onChange={(event) => setDebug(event.target.checked)} />
          Debug
        </label>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {result && (
        <div className="flex flex-wrap gap-3">
          <a href={downloadUrl(result.pdf_path)} target="_blank" rel="noreferrer" className="inline-block rounded bg-blue-700 px-4 py-2">
            Descargar PDF ({result.filename})
          </a>
          {result.debug_path && (
            <a href={downloadDebugUrl(result.debug_path)} target="_blank" rel="noreferrer" className="inline-block rounded bg-indigo-700 px-4 py-2">
              Descargar debug.json
            </a>
          )}
        </div>
      )}

      {debug && result?.debug && (
        <div className="space-y-2 rounded border border-indigo-700/60 bg-slate-950/70 p-3">
          <h3 className="text-lg font-semibold text-indigo-300">Debug</h3>
          <pre className="max-h-[420px] overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-200">
            {JSON.stringify(result.debug, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
