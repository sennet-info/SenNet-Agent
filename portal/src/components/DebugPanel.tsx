"use client";

import { useMemo, useState } from "react";

import { DebugPayload, DebugSeriesRow } from "@/lib/agent-types";

type DebugPanelProps = {
  debugPayload: DebugPayload | null;
  isLoading?: boolean;
  debugPath?: string | null;
};

const SENSITIVE_KEYS = ["token", "password", "authorization", "secret"];

function maskSensitive(value: unknown, key = ""): unknown {
  const lowerKey = key.toLowerCase();
  const shouldMask = SENSITIVE_KEYS.some((item) => lowerKey.includes(item));
  if (shouldMask) return "***";
  if (Array.isArray(value)) return value.map((item) => maskSensitive(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([innerKey, innerValue]) => [
        innerKey,
        maskSensitive(innerValue, innerKey),
      ]),
    );
  }
  return value;
}

function textSnippet(value: unknown) {
  if (typeof value !== "string") return "";
  const lines = value.split("\n").slice(0, 30).join("\n");
  return lines.length > 2048 ? `${lines.slice(0, 2048)}...` : lines;
}

export default function DebugPanel({ debugPayload, isLoading = false, debugPath }: DebugPanelProps) {
  const [search, setSearch] = useState("");
  const [selectedSeries, setSelectedSeries] = useState("");

  const sanitized = useMemo(() => (debugPayload ? (maskSensitive(debugPayload) as DebugPayload) : null), [debugPayload]);

  const seriesRows = useMemo(() => {
    const rows = (sanitized?.stats?.series ?? []) as DebugSeriesRow[];
    const filtered = rows.filter((row) => {
      const haystack = `${row.device ?? ""} ${row.series ?? ""}`.toLowerCase();
      return haystack.includes(search.toLowerCase());
    });
    return filtered.sort((a, b) => (Number(b.points ?? 0) - Number(a.points ?? 0)));
  }, [sanitized, search]);

  const sampleEntries = useMemo(() => Object.entries(sanitized?.sample_rows ?? {}), [sanitized?.sample_rows]);

  const activeSampleKey = selectedSeries || sampleEntries[0]?.[0] || "";
  const activeRows = sampleEntries.find(([key]) => key === activeSampleKey)?.[1] ?? [];

  async function copyDebugJson() {
    if (!sanitized) return;
    await navigator.clipboard.writeText(JSON.stringify(sanitized, null, 2));
  }

  async function copyQuerySnippet() {
    if (!sanitized?.query_proof?.snippet) return;
    await navigator.clipboard.writeText(String(sanitized.query_proof.snippet));
  }

  if (isLoading) {
    return <div className="rounded border border-indigo-700/60 bg-slate-950/70 p-3 text-sm text-slate-300">Cargando debug…</div>;
  }

  if (!sanitized) {
    return <div className="rounded border border-indigo-700/60 bg-slate-950/70 p-3 text-sm text-slate-300">No hay payload de debug disponible.</div>;
  }

  return (
    <div className="space-y-3 rounded border border-indigo-700/60 bg-slate-950/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-indigo-300">Debug</h3>
        <div className="flex gap-2">
          <button className="rounded bg-indigo-700 px-3 py-1 text-sm" type="button" onClick={copyDebugJson}>Copiar debug</button>
          {debugPath && <span className="text-xs text-slate-400">debug_path: {debugPath}</span>}
        </div>
      </div>

      <details open>
        <summary className="cursor-pointer font-medium">A) Inputs usados</summary>
        <div className="mt-2 space-y-2 text-sm">
          {Object.entries(sanitized.inputs ?? {}).map(([key, value]) => (
            <div key={key}>
              <span className="font-semibold">{key}: </span>
              {key === "devices" && Array.isArray(value) ? (
                <span className="inline-flex flex-wrap gap-1 align-middle">
                  {value.map((item) => (
                    <span key={String(item)} className="rounded bg-slate-700 px-2 py-0.5 text-xs">{String(item)}</span>
                  ))}
                </span>
              ) : (
                <span>{JSON.stringify(value)}</span>
              )}
            </div>
          ))}
        </div>
      </details>

      <details>
        <summary className="cursor-pointer font-medium">B) Rango resuelto</summary>
        <pre className="mt-2 overflow-auto rounded bg-slate-900 p-3 text-xs">{JSON.stringify(sanitized.resolved_range ?? {}, null, 2)}</pre>
      </details>

      <details>
        <summary className="cursor-pointer font-medium">C) Query proof</summary>
        <div className="mt-2 space-y-2 text-sm">
          <div><span className="font-semibold">sha256:</span> {sanitized.query_proof?.sha256 ?? "-"}</div>
          <pre className="max-h-64 overflow-auto rounded bg-slate-900 p-3 text-xs whitespace-pre-wrap">{textSnippet(sanitized.query_proof?.snippet)}</pre>
          <button className="rounded bg-slate-700 px-3 py-1 text-xs" type="button" onClick={copyQuerySnippet}>Copiar snippet</button>
        </div>
      </details>

      <details>
        <summary className="cursor-pointer font-medium">D) Data proof</summary>
        <div className="mt-2 space-y-2 text-sm">
          <div className="flex gap-2">
            <span className="rounded bg-slate-700 px-2 py-1 text-xs">total_series: {sanitized.stats?.total_series ?? 0}</span>
            <span className="rounded bg-slate-700 px-2 py-1 text-xs">total_points: {sanitized.stats?.total_points ?? 0}</span>
          </div>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar device o serie" className="w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm" />
          <div className="max-h-72 overflow-auto rounded border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900">
                <tr>
                  <th className="p-2">device</th><th className="p-2">series</th><th className="p-2">points</th><th className="p-2">first_ts</th><th className="p-2">last_ts</th>
                </tr>
              </thead>
              <tbody>
                {seriesRows.map((row, idx) => (
                  <tr key={`${row.device}-${row.series}-${idx}`} className="border-t border-slate-800">
                    <td className="p-2">{row.device ?? "-"}</td>
                    <td className="p-2">{row.series ?? "-"}</td>
                    <td className="p-2">{row.points ?? 0}</td>
                    <td className="p-2">{row.first_ts ?? "-"}</td>
                    <td className="p-2">{row.last_ts ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <details>
        <summary className="cursor-pointer font-medium">E) Sample rows</summary>
        <div className="mt-2 space-y-2 text-sm">
          <select value={activeSampleKey} onChange={(event) => setSelectedSeries(event.target.value)} className="w-full rounded border border-slate-700 bg-slate-950 p-2">
            {sampleEntries.map(([key]) => (
              <option key={key} value={key}>{key}</option>
            ))}
          </select>
          <pre className="max-h-64 overflow-auto rounded bg-slate-900 p-3 text-xs">{JSON.stringify(activeRows.slice(0, 10), null, 2)}</pre>
        </div>
      </details>

      <details>
        <summary className="cursor-pointer font-medium">F) Timings</summary>
        <div className="mt-2 space-y-2">
          {Object.entries(sanitized.timings_ms ?? {}).map(([key, value]) => {
            const ms = Number(value ?? 0);
            const total = Number((sanitized.timings_ms?.total as number) ?? 1);
            const pct = Math.min(100, Math.round((ms / total) * 100));
            return (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="rounded bg-slate-700 px-2 py-0.5">{key}: {ms} ms</span>
                  <span className="text-slate-400">{pct}%</span>
                </div>
                <div className="h-2 rounded bg-slate-800"><div className="h-2 rounded bg-indigo-500" style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
      </details>

      <details>
        <summary className="cursor-pointer font-medium">G) Warnings</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {(sanitized.warnings ?? []).map((item, idx) => (
            <li key={`${item}-${idx}`}>{item}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
