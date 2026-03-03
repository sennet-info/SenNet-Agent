"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Expand, Minimize, RefreshCw } from "lucide-react";

import { useSidebar } from "@/components/sidebar-context";
import { Button } from "@/components/ui/button";

type HealthState = {
  ok: boolean;
  status?: number;
  error?: string;
};

type EmbeddedAppProps = {
  title: string;
  subtitle?: string;
  src: string;
  healthUrl?: string;
  reloadable?: boolean;
};

const POLL_INTERVAL_MS = 15000;

export default function EmbeddedApp({ title, subtitle, src, healthUrl, reloadable = false }: EmbeddedAppProps) {
  const [iframeKey, setIframeKey] = useState(0);
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const [health, setHealth] = useState<HealthState | null>(healthUrl ? { ok: false } : null);
  const [loadingHealth, setLoadingHealth] = useState(Boolean(healthUrl));
  const { setSidebarHidden } = useSidebar();

  const storageKey = useMemo(() => `sennet:fullscreen:${title.toLowerCase()}`, [title]);

  const checkHealth = useCallback(async () => {
    if (!healthUrl) {
      return;
    }

    try {
      const response = await fetch(healthUrl, { cache: "no-store" });
      const payload = (await response.json()) as HealthState;
      setHealth(payload);
    } catch (error) {
      setHealth({ ok: false, error: error instanceof Error ? error.message : "Error" });
    } finally {
      setLoadingHealth(false);
    }
  }, [healthUrl]);

  useEffect(() => {
    if (!healthUrl) {
      return;
    }

    void checkHealth();
    const interval = window.setInterval(() => {
      void checkHealth();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [checkHealth, healthUrl]);

  useEffect(() => {
    const storedMode = window.localStorage.getItem(storageKey);
    if (storedMode === "1") {
      setFullscreenMode(true);
    }
  }, [storageKey]);

  useEffect(() => {
    setSidebarHidden(fullscreenMode);
    window.localStorage.setItem(storageKey, fullscreenMode ? "1" : "0");

    return () => {
      setSidebarHidden(false);
    };
  }, [fullscreenMode, setSidebarHidden, storageKey]);

  const handleReload = async () => {
    setIframeKey((prev) => prev + 1);
    await checkHealth();
  };

  const frameHeightClass = fullscreenMode ? "h-[calc(100vh-1.5rem)] md:h-[calc(100vh-2rem)]" : "h-[calc(100vh-7rem)]";

  return (
    <section className={`flex ${frameHeightClass} min-h-[520px] flex-col`}>
      <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{title}</h2>
          {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2">
          {healthUrl && health && (
            <span
              className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                health.ok
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/50 bg-rose-500/10 text-rose-300"
              }`}
            >
              {loadingHealth ? "Comprobando" : health.ok ? `OK ${health.status ?? ""}` : `KO ${health.status ?? ""}`}
            </span>
          )}

          {reloadable && (
            <Button onClick={handleReload} variant="secondary" size="sm" className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Recargar
            </Button>
          )}

          <Button onClick={() => setFullscreenMode((prev) => !prev)} variant="secondary" size="sm" className="gap-1.5">
            {fullscreenMode ? <Minimize className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
            {fullscreenMode ? "Salir" : "Pantalla completa"}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
        <iframe key={iframeKey} src={src} title={title} className="h-full w-full border-0 bg-white" />
      </div>
    </section>
  );
}
