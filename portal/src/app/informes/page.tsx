"use client";

import { useEffect, useMemo, useState } from "react";

import DebugPanel from "@/components/DebugPanel";
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
import { DebugPayload } from "@/lib/agent-types";

function toIsoAtStart(dateValue: string) {
  return `${dateValue}T00:00:00`;
}

function toIsoAtEnd(dateValue: string) {
  return `${dateValue}T23:59:59`;
}

const STORAGE_KEY = "informes_form_state_v1";

type StoredFormState = {
  tenant?: string;
  client?: string;
  site?: string;
  serial?: string;
  selected?: string[];
  rangeMode?: string;
  lastDays?: number;
  customStart?: string;
  customEnd?: string;
  debug?: boolean;
};

export default function InformesPage() {
  const [tenant, setTenant] = useState("");
  const [tenantOptions, setTenantOptions] = useState<string[]>([]);
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
  const [loadingClients, setLoadingClients] = useState(false);
  const [loadingSites, setLoadingSites] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [debugPayload, setDebugPayload] = useState<DebugPayload | null>(null);
  const [loadingDebugPayload, setLoadingDebugPayload] = useState(false);
  const [storedState, setStoredState] = useState<StoredFormState | null>(null);

  useEffect(() => {
    const savedRaw = window.localStorage.getItem(STORAGE_KEY);
    if (savedRaw) {
      try {
        setStoredState(JSON.parse(savedRaw) as StoredFormState);
      } catch {
        setStoredState({});
      }
    } else {
      setStoredState({});
    }
  }, []);


  useEffect(() => {
    if (tenant || tenantOptions.length > 0) return;
    if (storedState?.tenant) {
      setTenant(storedState.tenant);
    }
  }, [storedState?.tenant, tenant, tenantOptions.length]);

  useEffect(() => {
    const token = window.localStorage.getItem("agent_admin_token") ?? "";
    if (!token) return;
    adminListTenants(token)
      .then((resp) => {
        const aliases = Object.keys(resp.items);
        setTenantOptions(aliases);
        const storedTenant = storedState?.tenant;
        const nextTenant = storedTenant && aliases.includes(storedTenant) ? storedTenant : aliases[0] ?? "";
        if (nextTenant) setTenant(nextTenant);
      })
      .catch(() => undefined);
  }, [storedState?.tenant]);

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    setLoadingClients(true);
    setClient("");
    setSite("");
    setSerial("");
    setClients([]);
    setSites([]);
    setSerials([]);
    setDevices([]);
    setSelected([]);

    discoveryClients(tenant)
      .then((resp) => {
        if (cancelled) return;
        setClients(resp.items);
        const storedClient = storedState?.client;
        const nextClient = storedClient && resp.items.includes(storedClient) ? storedClient : resp.items[0] ?? "";
        setClient(nextClient);
      })
      .catch(() => {
        if (cancelled) return;
        setClients([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingClients(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenant, storedState?.client]);

  useEffect(() => {
    if (!tenant || !client) return;
    let cancelled = false;
    setLoadingSites(true);
    setSite("");
    setSerial("");
    setSites([]);
    setSerials([]);
    setDevices([]);
    setSelected([]);

    discoverySites(tenant, client)
      .then((resp) => {
        if (cancelled) return;
        setSites(resp.items);
        const storedSite = storedState?.site;
        const nextSite = storedSite && resp.items.includes(storedSite) ? storedSite : resp.items[0] ?? "";
        setSite(nextSite);
      })
      .finally(() => {
        if (!cancelled) setLoadingSites(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenant, client, storedState?.site]);

  useEffect(() => {
    if (!tenant || !client || !site) return;
    let cancelled = false;
    setLoadingDevices(true);

    Promise.all([discoverySerials(tenant, client, site), discoveryDevices(tenant, client, site)])
      .then(([serialResp, deviceResp]) => {
        if (cancelled) return;
        setSerials(serialResp.items);
        const storedSerial = storedState?.serial;
        setSerial(storedSerial && serialResp.items.includes(storedSerial) ? storedSerial : "");

        setDevices(deviceResp.items);
        const defaultSelected = deviceResp.items.filter((item) => item.toUpperCase().includes("GENERAL"));
        const storedSelected = (storedState?.selected ?? []).filter((item) => deviceResp.items.includes(item));
        setSelected(storedSelected.length > 0 ? storedSelected : defaultSelected);
      })
      .finally(() => {
        if (!cancelled) setLoadingDevices(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenant, client, site, storedState?.serial, storedState?.selected]);

  useEffect(() => {
    if (!tenant || !client || !site || !serial) return;
    let cancelled = false;
    setLoadingDevices(true);
    discoveryDevices(tenant, client, site, serial)
      .then((resp) => {
        if (cancelled) return;
        setDevices(resp.items);
        const defaultSelected = resp.items.filter((item) => item.toUpperCase().includes("GENERAL"));
        const storedSelected = (storedState?.selected ?? []).filter((item) => resp.items.includes(item));
        setSelected(storedSelected.length > 0 ? storedSelected : defaultSelected);
      })
      .finally(() => {
        if (!cancelled) setLoadingDevices(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenant, client, site, serial, storedState?.selected]);

  useEffect(() => {
    if (!storedState) return;
    if (storedState.rangeMode) setRangeMode(storedState.rangeMode);
    if (typeof storedState.lastDays === "number") setLastDays(storedState.lastDays);
    if (storedState.customStart) setCustomStart(storedState.customStart);
    if (storedState.customEnd) setCustomEnd(storedState.customEnd);
    if (typeof storedState.debug === "boolean") setDebug(storedState.debug);
  }, [storedState]);

  useEffect(() => {
    if (!storedState) return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tenant,
        client,
        site,
        serial,
        selected,
        rangeMode,
        lastDays,
        customStart,
        customEnd,
        debug,
      } as StoredFormState),
    );
  }, [tenant, client, site, serial, selected, rangeMode, lastDays, customStart, customEnd, debug, storedState]);

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

  async function loadDebugPayload(report: ReportResult) {
    if (report.debug) {
      setDebugPayload(report.debug as DebugPayload);
      return;
    }
    if (!report.debug_path) {
      setDebugPayload(null);
      return;
    }
    setLoadingDebugPayload(true);
    try {
      const response = await fetch(downloadDebugUrl(report.debug_path), { cache: "no-store" });
      if (!response.ok) throw new Error("No se pudo cargar debug.json");
      const data = (await response.json()) as DebugPayload;
      setDebugPayload(data);
    } catch {
      setDebugPayload(null);
    } finally {
      setLoadingDebugPayload(false);
    }
  }

  async function generateReport() {
    setLoading(true);
    setError("");
    setResult(null);
    setDebugPayload(null);
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
      if (debug) {
        await loadDebugPayload(report);
      }
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
        {tenantOptions.length > 0 ? (
          <select value={tenant} onChange={(event) => setTenant(event.target.value)} className="rounded border border-slate-700 bg-slate-950 p-2">
            {tenantOptions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        ) : (
          <input value={tenant} onChange={(event) => setTenant(event.target.value)} className="rounded border border-slate-700 bg-slate-950 p-2" placeholder="Tenant" />
        )}

        <select
          value={client}
          onChange={(event) => setClient(event.target.value)}
          disabled={!tenant || loadingClients}
          className="rounded border border-slate-700 bg-slate-950 p-2 disabled:opacity-60"
        >
          {loadingClients && <option>Cargando...</option>}
          {!loadingClients && clients.length === 0 && <option value="">Sin clientes</option>}
          {!loadingClients &&
            clients.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
        </select>

        <select value={site} onChange={(event) => setSite(event.target.value)} disabled={!client || loadingSites} className="rounded border border-slate-700 bg-slate-950 p-2 disabled:opacity-60">
          {loadingSites && <option>Cargando...</option>}
          {!loadingSites && sites.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select value={serial} onChange={(event) => setSerial(event.target.value)} disabled={!site || loadingDevices} className="rounded border border-slate-700 bg-slate-950 p-2 disabled:opacity-60">
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

      {debug && (loadingDebugPayload || debugPayload) && (
        <DebugPanel debugPayload={debugPayload} isLoading={loadingDebugPayload} debugPath={result?.debug_path ?? null} />
      )}
    </section>
  );
}
