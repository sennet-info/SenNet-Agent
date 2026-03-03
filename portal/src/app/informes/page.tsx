"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type HealthState = {
  ok: boolean;
  status?: number;
  error?: string;
};

const POLL_INTERVAL_MS = 15000;

export default function InformesPage() {
  const [health, setHealth] = useState<HealthState>({ ok: false });
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [iframeKey, setIframeKey] = useState(0);

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/agent-health", { cache: "no-store" });
      const payload = (await response.json()) as HealthState;
      setHealth(payload);
    } catch (error) {
      setHealth({ ok: false, error: error instanceof Error ? error.message : "Error" });
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    const interval = window.setInterval(() => {
      void checkHealth();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [checkHealth]);

  const handleReload = async () => {
    setIframeKey((prev) => prev + 1);
    await checkHealth();
  };

  return (
    <section className="flex min-h-[80vh] flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div>
          <h2 className="text-3xl font-semibold">Informes</h2>
          <p className="mt-1 text-slate-300">Agente SenNet</p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
              health.ok
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/50 bg-rose-500/10 text-rose-300"
            }`}
          >
            {loadingHealth ? "Comprobando..." : health.ok ? `OK ${health.status ?? ""}` : `KO ${health.status ?? ""}`}
          </span>
          <Button onClick={handleReload}>Recargar</Button>
        </div>
      </div>

      {!health.ok && !loadingHealth && (
        <p className="mb-3 text-sm text-rose-300">
          No se pudo contactar al agente. {health.error ? `Detalle: ${health.error}` : ""}
        </p>
      )}

      <div className="min-h-[70vh] flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
        <iframe
          key={iframeKey}
          src="/api/agent/"
          title="Agente SenNet"
          className="h-[70vh] min-h-[70vh] w-full bg-white"
        />
      </div>
    </section>
  );
}
