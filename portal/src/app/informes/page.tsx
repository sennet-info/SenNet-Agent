"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { BarChart2, Check, ChevronDown, Cpu, Flame, Gauge, Lightbulb, PieChart, Plug, Star, Table, TrendingUp } from "lucide-react";

import DebugPanel from "@/components/DebugPanel";
import {
  adminListRoles,
  adminListTenants,
  createReport,
  resolveDefaultPrice,
  discoveryClients,
  discoveryDevices,
  discoverySerials,
  discoverySites,
  downloadDebugUrl,
  downloadUrl,
  PriceSource,
  ReportResult,
} from "@/lib/agent-api-client";
import { DebugPayload } from "@/lib/agent-types";
import { ReportRangeMode, resolveReportRange } from "@/lib/report-time";

const STORAGE_KEY = "informes_form_state_v1";
const INITIAL_PRICE_FALLBACK = 0.14;
const DEFAULT_MAX_WORKERS = 1;
const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  serial: "equipo (serial)",
  site: "instalación",
  client: "cliente",
  tenant: "tenant",
  fallback: "fallback global",
  manual_override: "tarifa manual para este informe",
};

const PALETTE_OPTIONS = [
  { value: "rojo", label: "Rojo", colorClass: "bg-red-600" },
  { value: "azul", label: "Azul", colorClass: "bg-blue-600" },
  { value: "verde", label: "Verde", colorClass: "bg-green-600" },
  { value: "morado", label: "Morado", colorClass: "bg-purple-600" },
  { value: "oscuro", label: "Oscuro", colorClass: "bg-slate-700" },
] as const;

type ReportComponentKey =
  | "showProfile"
  | "showSummary"
  | "showPrev"
  | "showHeatmap"
  | "showCumulative"
  | "showTopDays";

const REPORT_COMPONENTS: Array<{
  key: ReportComponentKey;
  label: string;
  description: string;
  Icon: ComponentType<{ className?: string }>;
}> = [
  { key: "showProfile", label: "Perfil horario", description: "Promedio de consumo por hora", Icon: PieChart },
  { key: "showSummary", label: "Tabla resumen", description: "Resumen con tendencias", Icon: Table },
  { key: "showPrev", label: "Comparar mes anterior", description: "Barras comparativas", Icon: BarChart2 },
  { key: "showHeatmap", label: "Heatmap semanal", description: "Mapa de calor hora×día", Icon: Flame },
  { key: "showCumulative", label: "Consumo acumulado", description: "Línea de consumo acumulado", Icon: TrendingUp },
  { key: "showTopDays", label: "Top días de consumo", description: "Ranking de los 7 días con mayor consumo", Icon: Star },
];

function formatPrice(price: number) {
  return `${price.toFixed(3).replace(".", ",")} €/kWh`;
}

const ENERGY_ROLE_SET = new Set(["consumption", "generation", "storage"]);
const ENERGY_DEVICE_HINTS = ["ENER", "KWH", "CONSUM", "GENERAL", "ACTIVA", "METER", "CONTADOR", "INV"]; 

function deviceLooksEnergy(device: string) {
  const normalized = device.toUpperCase();
  return ENERGY_DEVICE_HINTS.some((hint) => normalized.includes(hint));
}

function getDefaultMaxWorkers() {
  return DEFAULT_MAX_WORKERS;
}

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
  const [selectedSite, setSelectedSite] = useState("");
  const [serials, setSerials] = useState<string[]>([]);
  const [serial, setSerial] = useState("");
  const [devices, setDevices] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [deviceSearch, setDeviceSearch] = useState("");
  const [rangeMode, setRangeMode] = useState<ReportRangeMode>("last_n_days");
  const [lastDays, setLastDays] = useState(7);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [resolvedPrice, setResolvedPrice] = useState(INITIAL_PRICE_FALLBACK);
  const [resolvedPriceSource, setResolvedPriceSource] = useState<PriceSource>("fallback");
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceOverride, setPriceOverride] = useState(false);
  const [manualPrice, setManualPrice] = useState(INITIAL_PRICE_FALLBACK);
  const [resolvedPriceKey, setResolvedPriceKey] = useState<string | null>(null);
  const [maxWorkers] = useState(() => getDefaultMaxWorkers());
  const [forceRecalculate] = useState(false);
  const [debug, setDebug] = useState(false);
  const [reportPalette, setReportPalette] = useState("rojo");
  const [showProfile, setShowProfile] = useState(true);
  const [showSummary, setShowSummary] = useState(true);
  const [showPrev, setShowPrev] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showCumulative, setShowCumulative] = useState(false);
  const [showTopDays, setShowTopDays] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingClients, setLoadingClients] = useState(false);
  const [loadingSites, setLoadingSites] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [debugPayload, setDebugPayload] = useState<DebugPayload | null>(null);
  const [loadingDebugPayload, setLoadingDebugPayload] = useState(false);
  const [storedState, setStoredState] = useState<StoredFormState | null>(null);
  const [deviceRoles, setDeviceRoles] = useState<Record<string, string>>({});
  const reportComponentState: Record<ReportComponentKey, boolean> = {
    showProfile,
    showSummary,
    showPrev,
    showHeatmap,
    showCumulative,
    showTopDays,
  };
  const filteredDevices = devices.filter((d) => d.toLowerCase().includes(deviceSearch.toLowerCase()));
  const deviceCards = filteredDevices.map((name) => {
    const upperName = name.toUpperCase();
    let group = "otros";
    let Icon = Plug;
    if (upperName.includes("GENERAL")) {
      group = "general";
      Icon = Gauge;
    } else if (upperName.includes("LUZ") || upperName.includes("LIGHT")) {
      group = "iluminacion";
      Icon = Lightbulb;
    } else if (upperName.includes("IN") || upperName.includes("ENTRADA")) {
      group = "entradas";
      Icon = Cpu;
    }
    return { id: name, name, group, icon: Icon };
  });
  const groupedDevices = deviceCards.reduce<Record<string, typeof deviceCards>>((acc, device) => {
    if (!acc[device.group]) acc[device.group] = [];
    acc[device.group].push(device);
    return acc;
  }, {});
  const groupLabels: Record<string, string> = {
    entradas: "Entradas",
    general: "General",
    iluminacion: "Iluminación",
    otros: "Otros",
  };

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

    adminListRoles(token)
      .then((resp) => {
        setDeviceRoles(resp.items ?? {});
      })
      .catch(() => {
        setDeviceRoles({});
      });
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
        setSelectedSite(nextSite);
      })
      .finally(() => {
        if (!cancelled) setLoadingSites(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenant, client, storedState?.site]);

  useEffect(() => {
    setSelectedSite(site);
  }, [site]);

  useEffect(() => {
    if (!selectedSite) return;
    setSite(selectedSite);
  }, [selectedSite]);

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
    if (storedState.rangeMode) {
      const aliases: Record<string, ReportRangeMode> = { last_days: "last_n_days", full_month: "month_to_date" };
      const nextMode = aliases[storedState.rangeMode] ?? storedState.rangeMode;
      if (["last_n_days", "month_to_date", "previous_full_month", "custom"].includes(nextMode)) {
        setRangeMode(nextMode as ReportRangeMode);
      }
    }
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


  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    setPriceLoading(true);
    resolveDefaultPrice(tenant, client || undefined, site || undefined, serial || undefined)
      .then((response) => {
        if (cancelled) return;
        setResolvedPrice(response.price);
        setResolvedPriceSource(response.source);
        setResolvedPriceKey(response.matched_key ?? null);
        if (!priceOverride) {
          setManualPrice(response.price);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedPrice(INITIAL_PRICE_FALLBACK);
        setResolvedPriceSource("fallback");
        setResolvedPriceKey(null);
      })
      .finally(() => {
        if (!cancelled) setPriceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenant, client, site, serial, priceOverride]);


  const shouldShowPricing = useMemo(() => {
    if (selected.length === 0) return false;
    return selected.some((device) => {
      const role = deviceRoles[device];
      if (role && ENERGY_ROLE_SET.has(role)) return true;
      return deviceLooksEnergy(device);
    });
  }, [selected, deviceRoles]);

  const rangePayload = useMemo(() => {
    try {
      const resolved = resolveReportRange({
        mode: rangeMode,
        lastDays,
        customStart,
        customEnd,
      });
      return {
        range_mode: resolved.range_mode,
        last_days: resolved.criteria.days as number | undefined,
        range_label: resolved.range_label,
        timezone: resolved.timezone,
        range_flux: resolved.range_flux,
        start_dt: resolved.start_dt,
        end_dt: resolved.end_dt,
      };
    } catch {
      return null;
    }
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
      if (!rangePayload) throw new Error("Rango temporal inválido");
      const report = await createReport({
        tenant,
        client,
        site,
        serial: serial || undefined,
        devices: selected,
        price: priceOverride ? manualPrice : resolvedPrice,
        price_source: priceOverride ? "manual_override" : resolvedPriceSource,
        price_override: priceOverride,
        max_workers: maxWorkers,
        force_recalculate: forceRecalculate,
        debug,
        report_options: {
          palette: reportPalette,
          show_profile: showProfile,
          show_summary: showSummary,
          show_prev: showPrev,
          show_heatmap: showHeatmap,
          show_cumulative: showCumulative,
          show_top_days: showTopDays,
        },
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
      <p className="text-sm italic text-slate-400">
        Selecciona ámbito, dispositivos y rango de fechas para generar un informe.
      </p>

      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-3">
        <h3 className="text-base font-semibold text-slate-200">Ámbito</h3>
        <div className="grid gap-2 md:grid-cols-4">
          <div className="space-y-1">
            <label htmlFor="tenant-select" className="text-xs text-slate-400">Red / Tenant</label>
            {tenantOptions.length > 0 ? (
              <select id="tenant-select" value={tenant} onChange={(event) => setTenant(event.target.value)} className="w-full rounded border border-slate-700 bg-slate-950 p-2">
                {tenantOptions.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            ) : (
              <input id="tenant-select" value={tenant} onChange={(event) => setTenant(event.target.value)} className="w-full rounded border border-slate-700 bg-slate-950 p-2" placeholder="Tenant" />
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="client-select" className="text-xs text-slate-400">Cliente</label>
            <select
              id="client-select"
              value={client}
              onChange={(event) => setClient(event.target.value)}
              disabled={!tenant || loadingClients}
              className="w-full rounded border border-slate-700 bg-slate-950 p-2 disabled:opacity-60"
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
          </div>

          <div className="space-y-1">
            <label htmlFor="site" className="text-xs text-slate-400">Instalación</label>
            <select
              id="site"
              className="w-full rounded border border-slate-700 bg-slate-900/50 px-2 py-1 text-sm text-slate-200"
              value={selectedSite}
              onChange={(event) => setSelectedSite(event.target.value)}
              disabled={!client || loadingSites}
            >
              {loadingSites && <option value="">Cargando...</option>}
              {!loadingSites && sites.length === 0 && <option value="">Sin instalaciones</option>}
              {!loadingSites &&
                sites.map((siteItem) => (
                  <option key={siteItem} value={siteItem}>
                    {siteItem}
                  </option>
                ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="serial-select" className="text-xs text-slate-400">Equipo (serial)</label>
            <select id="serial-select" value={serial} onChange={(event) => setSerial(event.target.value)} disabled={!site || loadingDevices} className="w-full rounded border border-slate-700 bg-slate-950 p-2 disabled:opacity-60">
              <option value="">Todos los seriales</option>
              {serials.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-3">
        <h3 className="text-base font-semibold text-slate-200">Dispositivos</h3>
        <p className="text-xs text-slate-400">Puedes escribir para buscar un dispositivo</p>
        <div className="flex gap-2">
          <button className="rounded bg-slate-700 px-2 py-1" onClick={() => setSelected(devices)} type="button">Todos</button>
          <button className="rounded bg-slate-700 px-2 py-1" onClick={() => setSelected([])} type="button">Nada</button>
          <button className="rounded bg-slate-700 px-2 py-1" onClick={() => setSelected(devices.filter((d) => d.toUpperCase().includes("GENERAL")))} type="button">General</button>
        </div>
        <input
          type="text"
          value={deviceSearch}
          onChange={(e) => setDeviceSearch(e.target.value)}
          className="w-full rounded bg-slate-800/50 px-3 py-1 text-sm"
          placeholder="Buscar dispositivo…"
        />
        <fieldset className="space-y-3">
          <legend className="sr-only">Seleccionar dispositivos</legend>
          {filteredDevices.length === 0 ? (
            <p className="text-sm text-slate-400">No se encontraron dispositivos</p>
          ) : (
            Object.entries(groupedDevices).map(([group, groupItems]) => (
              <div key={group} className="space-y-2">
                <p className="text-sm font-semibold text-slate-300">{groupLabels[group] ?? group}</p>
                <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {groupItems.map((device) => {
                    const isSelected = selected.includes(device.id);
                    return (
                      <div
                        key={device.id}
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          setSelected((prev) =>
                            isSelected ? prev.filter((item) => item !== device.id) : [...prev, device.id],
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelected((prev) =>
                              isSelected ? prev.filter((item) => item !== device.id) : [...prev, device.id],
                            );
                          }
                        }}
                        className={`flex h-11 cursor-pointer items-center justify-between rounded border bg-slate-900/40 p-2 text-left ${
                          isSelected ? "border-emerald-600 bg-emerald-800/30" : "border-slate-700 bg-slate-900/40"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <device.icon className="h-4 w-4" aria-hidden="true" />
                          <span className="sr-only">Icono de dispositivo</span>
                          <span className="text-sm">{device.name}</span>
                        </span>
                        {isSelected && <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </fieldset>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-3">
        <h3 className="text-base font-semibold text-slate-200">Rango de fechas</h3>
        <div className="grid gap-2 md:grid-cols-4">
          <select value={rangeMode} onChange={(event) => setRangeMode(event.target.value as ReportRangeMode)} className="rounded border border-slate-700 bg-slate-950 p-2">
            <option value="last_n_days">Últimos N días</option>
            <option value="month_to_date">Mes en curso</option>
            <option value="previous_full_month">Último mes cerrado</option>
            <option value="custom">Personalizado</option>
          </select>
          <input type="number" min={1} value={lastDays} onChange={(event) => setLastDays(Number(event.target.value))} disabled={rangeMode !== "last_n_days"} className="rounded border border-slate-700 bg-slate-950 p-2" />
          <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} disabled={rangeMode !== "custom"} className="rounded border border-slate-700 bg-slate-950 p-2" />
          <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} disabled={rangeMode !== "custom"} className="rounded border border-slate-700 bg-slate-950 p-2" />
        </div>
        <p className="text-xs text-slate-400">{rangeMode === "last_n_days" ? "Se usará desde ahora menos N días hasta ahora." : rangeMode === "month_to_date" ? "Mes en curso: desde el día 1 a las 00:00 hasta este momento." : rangeMode === "previous_full_month" ? "Mes anterior completo: desde el día 1 00:00 hasta el último día 23:59:59." : "Se usará exactamente desde las 00:00 del inicio hasta las 23:59:59 del fin."}</p>
      </div>

      {shouldShowPricing && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-3">
          <h3 className="text-base font-semibold text-slate-200">Tarifa energética</h3>
          <p className="text-sm text-slate-200">Precio aplicado al informe: <span className="font-semibold">{formatPrice(priceOverride ? manualPrice : resolvedPrice)}</span></p>
          <p className="text-xs text-slate-400">{priceLoading
            ? "Resolviendo tarifa por defecto..."
            : `Tarifa por defecto detectada: ${formatPrice(resolvedPrice)} · Origen: ${PRICE_SOURCE_LABELS[resolvedPriceSource]}${resolvedPriceKey ? ` (${resolvedPriceKey})` : ""}`}</p>
          <p className="text-xs text-slate-500">Este valor se aplicará a los medidores energéticos incluidos en el informe. Por defecto se usa la tarifa configurada para esta instalación o equipo. Puedes cambiarla solo para este informe si lo necesitas.</p>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={priceOverride} onChange={(event) => {
              const enabled = event.target.checked;
              setPriceOverride(enabled);
              if (!enabled) setManualPrice(resolvedPrice);
            }} />
            Usar otra tarifa para este informe
          </label>
          {priceOverride && (
            <input type="number" min={0} step="0.001" value={manualPrice} onChange={(event) => setManualPrice(Number(event.target.value))} className="rounded border border-slate-700 bg-slate-950 p-2 max-w-xs" />
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-200">Opciones avanzadas</h3>
          <button
            className="inline-flex items-center gap-2 text-sm text-slate-300 underline-offset-2 hover:text-white hover:underline"
            onClick={() => setShowAdvancedOptions((prev) => !prev)}
            type="button"
          >
            {showAdvancedOptions ? "Ocultar" : "Mostrar"}
            <ChevronDown className={`h-4 w-4 transition-transform ${showAdvancedOptions ? "rotate-180" : "rotate-0"}`} />
          </button>
        </div>
        {showAdvancedOptions && (
          <div className="mt-3 grid gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={debug} onChange={(event) => setDebug(event.target.checked)} />
              Debug
            </label>
            <p className="text-xs text-slate-400">Los parámetros técnicos de procesamiento se gestionan automáticamente para mantener una experiencia simple.</p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-3">
        <h3 className="text-base font-semibold text-slate-200">Configuración del informe</h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-slate-300">Color del informe</h4>
            <div className="grid gap-2 grid-cols-3 sm:grid-cols-5">
              {PALETTE_OPTIONS.map((palette) => (
                <button
                  key={palette.value}
                  type="button"
                  onClick={() => setReportPalette(palette.value)}
                  className="inline-flex flex-col items-center gap-1 rounded-md border border-slate-700/80 bg-slate-900/40 px-2 py-2 text-xs text-slate-300 hover:border-slate-500"
                >
                  <span
                    className={`h-6 w-6 rounded-full ${palette.colorClass} ${
                      reportPalette === palette.value ? "ring-2 ring-white ring-offset-2 ring-offset-slate-950" : ""
                    }`}
                  />
                  <span className="text-xs">{palette.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-slate-300">Componentes del informe</h4>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {REPORT_COMPONENTS.map(({ key, label, description, Icon }) => (
                <label key={key} className="flex items-start justify-between gap-3 rounded border border-slate-700 bg-slate-900/40 p-3">
                  <span className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-4 w-4 text-slate-300" />
                    <span>
                      <span className="block text-sm text-slate-100">{label}</span>
                      <span className="text-xs text-slate-400">{description}</span>
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={reportComponentState[key]}
                    onChange={(event) => {
                      const nextValue = event.target.checked;
                      if (key === "showProfile") setShowProfile(nextValue);
                      if (key === "showSummary") setShowSummary(nextValue);
                      if (key === "showPrev") setShowPrev(nextValue);
                      if (key === "showHeatmap") setShowHeatmap(nextValue);
                      if (key === "showCumulative") setShowCumulative(nextValue);
                      if (key === "showTopDays") setShowTopDays(nextValue);
                    }}
                    className="mt-0.5"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded bg-emerald-700 px-4 py-2" disabled={loading || selected.length === 0} onClick={generateReport} type="button">
          {loading ? "Generando..." : "Generar"}
        </button>
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
