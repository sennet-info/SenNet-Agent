"use client";

import { FormEvent, useEffect, useState } from "react";

import { adminDeleteTenant, adminListTenants, adminPutTenant, TenantConfig } from "@/lib/agent-api-client";

const EMPTY_FORM = { alias: "", url: "", token: "", org: "", bucket: "" };

export default function ConexionesPage() {
  const [adminToken, setAdminToken] = useState("");
  const [tenants, setTenants] = useState<Record<string, TenantConfig>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    const saved = window.localStorage.getItem("agent_admin_token") ?? "";
    setAdminToken(saved);
  }, []);

  async function loadTenants(token = adminToken) {
    if (!token) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await adminListTenants(token);
      setTenants(response.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar tenants");
    } finally {
      setBusy(false);
    }
  }

  async function saveToken() {
    window.localStorage.setItem("agent_admin_token", adminToken);
    await loadTenants(adminToken);
  }

  async function submitTenant(event: FormEvent) {
    event.preventDefault();
    if (!form.alias.trim()) {
      setError("Alias requerido");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await adminPutTenant(adminToken, form.alias, {
        url: form.url,
        token: form.token,
        org: form.org,
        bucket: form.bucket,
      });
      setForm(EMPTY_FORM);
      await loadTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar tenant");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTenant(alias: string) {
    setBusy(true);
    setError("");
    try {
      await adminDeleteTenant(adminToken, alias);
      await loadTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar tenant");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <h2 className="text-3xl font-semibold tracking-tight">Conexiones (Tenants)</h2>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <label className="mb-2 block text-sm text-slate-300">Token admin (Bearer)</label>
        <div className="flex gap-2">
          <input
            value={adminToken}
            onChange={(event) => setAdminToken(event.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
            placeholder="AGENT_ADMIN_TOKEN"
          />
          <button onClick={saveToken} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium" type="button">
            Guardar y cargar
          </button>
        </div>
      </div>

      <form onSubmit={submitTenant} className="grid gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4 md:grid-cols-5">
        {Object.keys(EMPTY_FORM).map((key) => (
          <input
            key={key}
            value={form[key as keyof typeof EMPTY_FORM]}
            onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
            placeholder={key}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
          />
        ))}
        <button className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium" disabled={busy || !adminToken} type="submit">
          Guardar tenant
        </button>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="overflow-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-left">
            <tr>
              <th className="px-3 py-2">Alias</th>
              <th className="px-3 py-2">URL</th>
              <th className="px-3 py-2">Org</th>
              <th className="px-3 py-2">Bucket</th>
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(tenants).map(([alias, tenant]) => (
              <tr key={alias} className="border-t border-slate-800">
                <td className="px-3 py-2">{alias}</td>
                <td className="px-3 py-2">{tenant.url}</td>
                <td className="px-3 py-2">{tenant.org}</td>
                <td className="px-3 py-2">{tenant.bucket}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setForm({ alias, ...tenant })}
                    className="mr-2 rounded bg-slate-700 px-2 py-1"
                  >
                    Editar
                  </button>
                  <button type="button" onClick={() => deleteTenant(alias)} className="rounded bg-red-700 px-2 py-1">
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
            {!Object.keys(tenants).length && (
              <tr>
                <td className="px-3 py-3 text-slate-400" colSpan={5}>
                  Sin tenants cargados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
