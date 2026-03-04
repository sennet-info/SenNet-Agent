"use client";

import { useEffect, useMemo, useState } from "react";

import {
  adminDeleteRole,
  adminListRoles,
  adminListTenants,
  adminPutRole,
  discoveryClients,
  discoveryDevices,
  discoverySites,
} from "@/lib/agent-api-client";
import { ROLE_LABELS, ROLE_OPTIONS } from "@/lib/agent-constants";

export default function InventarioPage() {
  const [token, setToken] = useState("");
  const [tenants, setTenants] = useState<string[]>([]);
  const [tenant, setTenant] = useState("");
  const [clients, setClients] = useState<string[]>([]);
  const [client, setClient] = useState("");
  const [sites, setSites] = useState<string[]>([]);
  const [site, setSite] = useState("");
  const [devices, setDevices] = useState<string[]>([]);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem("agent_admin_token") ?? "";
    setToken(saved);
  }, []);

  const unknown = useMemo(() => devices.filter((device) => !roles[device]), [devices, roles]);
  const known = useMemo(() => devices.filter((device) => !!roles[device]), [devices, roles]);

  async function loadAdminData() {
    if (!token) return;
    setError("");
    try {
      const [tenantResp, roleResp] = await Promise.all([adminListTenants(token), adminListRoles(token)]);
      const names = Object.keys(tenantResp.items);
      setTenants(names);
      setTenant((prev) => prev || names[0] || "");
      setRoles(roleResp.items);
      window.localStorage.setItem("agent_admin_token", token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando datos admin");
    }
  }

  useEffect(() => {
    if (!tenant) return;
    discoveryClients(tenant)
      .then((resp) => {
        setClients(resp.items);
        setClient(resp.items[0] ?? "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error cargando clients"));
  }, [tenant]);

  useEffect(() => {
    if (!tenant || !client) return;
    discoverySites(tenant, client)
      .then((resp) => {
        setSites(resp.items);
        setSite(resp.items[0] ?? "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error cargando sites"));
  }, [tenant, client]);

  useEffect(() => {
    if (!tenant || !client || !site) return;
    discoveryDevices(tenant, client, site)
      .then((resp) => setDevices(resp.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Error cargando devices"));
  }, [tenant, client, site]);

  async function saveRole(device: string, role: string) {
    try {
      await adminPutRole(token, device, role);
      setRoles((prev) => ({ ...prev, [device]: role }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar rol");
    }
  }

  async function removeRole(device: string) {
    try {
      await adminDeleteRole(token, device);
      setRoles((prev) => {
        const clone = { ...prev };
        delete clone[device];
        return clone;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar rol");
    }
  }

  return (
    <section className="space-y-5">
      <h2 className="text-3xl font-semibold tracking-tight">Inventario & Roles</h2>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <label className="mb-2 block text-sm text-slate-300">Token admin</label>
        <div className="flex gap-2">
          <input
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <button type="button" onClick={loadAdminData} className="rounded bg-blue-700 px-3 py-2">
            Cargar
          </button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <select value={tenant} onChange={(event) => setTenant(event.target.value)} className="rounded border border-slate-700 bg-slate-950 p-2">
          {tenants.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
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
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded border border-slate-800 p-3">
          <h3 className="mb-2 font-medium">Sin rol ({unknown.length})</h3>
          <div className="space-y-2">
            {unknown.map((device) => (
              <div key={device} className="flex items-center gap-2">
                <span className="flex-1 text-sm">{device}</span>
                <select onChange={(event) => saveRole(device, event.target.value)} defaultValue="" className="rounded border border-slate-700 bg-slate-950 p-1 text-sm">
                  <option value="" disabled>
                    Asignar rol
                  </option>
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded border border-slate-800 p-3">
          <h3 className="mb-2 font-medium">Con rol ({known.length})</h3>
          <div className="space-y-2">
            {known.map((device) => (
              <div key={device} className="flex items-center gap-2">
                <span className="flex-1 text-sm">{device}</span>
                <select
                  value={roles[device]}
                  onChange={(event) => saveRole(device, event.target.value)}
                  className="rounded border border-slate-700 bg-slate-950 p-1 text-sm"
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => removeRole(device)} className="rounded bg-red-700 px-2 py-1 text-xs">
                  Quitar
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
