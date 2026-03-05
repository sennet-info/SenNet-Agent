"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  adminListTenants,
  discoveryClients,
  discoveryDevices,
  discoverySerials,
  discoverySites,
  downloadUrl,
  SchedulerTask,
  schedulerCreateTask,
  schedulerDeleteTask,
  schedulerGetSmtp,
  schedulerListTasks,
  schedulerPutSmtp,
  schedulerRunTask,
  schedulerTestSmtp,
  schedulerUpdateTask,
  SmtpConfigPayload,
} from "@/lib/agent-api-client";

type TabName = "new" | "tasks" | "smtp";

const EMPTY_SMTP: SmtpConfigPayload = { server: "", port: 587, user: "", password: "" };

export default function ProgramadorPage() {
  const [tab, setTab] = useState<TabName>("new");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [tenantOptions, setTenantOptions] = useState<string[]>([]);
  const [clients, setClients] = useState<string[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [serials, setSerials] = useState<string[]>([]);
  const [devices, setDevices] = useState<string[]>([]);
  const [tasks, setTasks] = useState<SchedulerTask[]>([]);
  const [smtp, setSmtp] = useState<SmtpConfigPayload>(EMPTY_SMTP);
  const [testRecipient, setTestRecipient] = useState("");

  const [form, setForm] = useState({
    name: "",
    tenant: "",
    client: "",
    site: "",
    serial: "",
    device: "",
    extraDevicesCsv: "",
    rangeMode: "last_7_days",
    startDt: "",
    endDt: "",
    frequency: "daily",
    weekday: "1",
    time: "08:00",
    emailsCsv: "",
  });

  const tabStyle = (target: TabName) =>
    `rounded px-3 py-2 text-sm ${tab === target ? "bg-blue-600" : "bg-slate-800 text-slate-200"}`;

  useEffect(() => {
    const saved = window.localStorage.getItem("agent_admin_token") ?? "";
    setToken(saved);
  }, []);

  async function initialLoad(adminToken = token) {
    if (!adminToken) return;
    setBusy(true);
    setError("");
    try {
      const [tenantRes, tasksRes, smtpRes] = await Promise.all([
        adminListTenants(adminToken),
        schedulerListTasks(adminToken),
        schedulerGetSmtp(adminToken),
      ]);
      const aliases = Object.keys(tenantRes.items);
      setTenantOptions(aliases);
      setTasks(tasksRes.items);
      setSmtp({ ...EMPTY_SMTP, ...smtpRes.item });
      if (!form.tenant && aliases.length) setForm((prev) => ({ ...prev, tenant: aliases[0] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar datos");
    } finally {
      setBusy(false);
    }
  }

  async function saveTokenAndLoad() {
    window.localStorage.setItem("agent_admin_token", token);
    await initialLoad(token);
  }

  useEffect(() => {
    if (!form.tenant) return;
    discoveryClients(form.tenant).then((res) => setClients(res.items)).catch(() => setClients([]));
  }, [form.tenant]);

  useEffect(() => {
    if (!form.tenant || !form.client) return;
    discoverySites(form.tenant, form.client).then((res) => setSites(res.items)).catch(() => setSites([]));
  }, [form.tenant, form.client]);

  useEffect(() => {
    if (!form.tenant || !form.client || !form.site) return;
    discoverySerials(form.tenant, form.client, form.site).then((res) => setSerials(res.items)).catch(() => setSerials([]));
    discoveryDevices(form.tenant, form.client, form.site, form.serial || undefined)
      .then((res) => setDevices(res.items))
      .catch(() => setDevices([]));
  }, [form.tenant, form.client, form.site, form.serial]);

  const extraDevices = useMemo(
    () => form.extraDevicesCsv.split(",").map((v) => v.trim()).filter(Boolean),
    [form.extraDevicesCsv],
  );

  async function submitTask(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setOkMsg("");
    try {
      await schedulerCreateTask(token, {
        name: form.name || undefined,
        tenant: form.tenant,
        client: form.client,
        site: form.site,
        serial: form.serial || undefined,
        device: form.device,
        extra_devices: extraDevices,
        frequency: form.frequency as "daily" | "weekly" | "monthly" | "cron",
        weekday: form.frequency === "weekly" ? Number(form.weekday) : undefined,
        time: form.time,
        report_range_mode: form.rangeMode,
        start_dt: form.startDt || undefined,
        end_dt: form.endDt || undefined,
        emails: form.emailsCsv.split(",").map((v) => v.trim()).filter(Boolean),
        enabled: true,
      });
      setOkMsg("Tarea guardada");
      await initialLoad(token);
      setTab("tasks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear tarea");
    } finally {
      setBusy(false);
    }
  }

  async function toggleTaskEnabled(task: SchedulerTask) {
    try {
      await schedulerUpdateTask(token, task.id, { enabled: !task.enabled });
      await initialLoad(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar estado");
    }
  }

  async function runTask(taskId: string) {
    try {
      const result = await schedulerRunTask(token, taskId);
      window.open(downloadUrl(result.pdf_path), "_blank");
      setOkMsg(`Ejecución OK: ${result.filename}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo ejecutar");
    }
  }

  async function removeTask(taskId: string) {
    try {
      await schedulerDeleteTask(token, taskId);
      await initialLoad(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar");
    }
  }

  async function saveSmtp() {
    setBusy(true);
    setError("");
    try {
      await schedulerPutSmtp(token, smtp);
      setOkMsg("SMTP guardado");
      await initialLoad(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar SMTP");
    } finally {
      setBusy(false);
    }
  }

  async function sendSmtpTest() {
    try {
      await schedulerTestSmtp(token, testRecipient);
      setOkMsg("Correo de prueba enviado");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar test SMTP");
    }
  }

  return (
    <section className="space-y-6">
      <h2 className="text-3xl font-semibold tracking-tight">Programador de tareas automáticas</h2>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <label className="mb-2 block text-sm text-slate-300">Token admin (Bearer)</label>
        <div className="flex gap-2">
          <input value={token} onChange={(e) => setToken(e.target.value)} className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" />
          <button onClick={saveTokenAndLoad} className="rounded-md bg-blue-600 px-4 py-2 text-sm" type="button">Cargar</button>
        </div>
      </div>

      <div className="flex gap-2">
        <button className={tabStyle("new")} onClick={() => setTab("new")}>Nueva tarea</button>
        <button className={tabStyle("tasks")} onClick={() => setTab("tasks")}>Tareas activas</button>
        <button className={tabStyle("smtp")} onClick={() => setTab("smtp")}>Configuración SMTP</button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {okMsg && <p className="text-sm text-emerald-400">{okMsg}</p>}

      {tab === "new" && (
        <form onSubmit={submitTask} className="grid gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4 md:grid-cols-3">
          <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Alias opcional" className="rounded border border-slate-700 bg-slate-950 px-3 py-2" />
          <select value={form.tenant} onChange={(e) => setForm((p) => ({ ...p, tenant: e.target.value }))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2">
            <option value="">Tenant</option>{tenantOptions.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select value={form.client} onChange={(e) => setForm((p) => ({ ...p, client: e.target.value }))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2">
            <option value="">Cliente</option>{clients.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select value={form.site} onChange={(e) => setForm((p) => ({ ...p, site: e.target.value }))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2">
            <option value="">Site</option>{sites.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select value={form.serial} onChange={(e) => setForm((p) => ({ ...p, serial: e.target.value }))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2">
            <option value="">Serial (opcional)</option>{serials.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select value={form.device} onChange={(e) => setForm((p) => ({ ...p, device: e.target.value }))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2">
            <option value="">Dispositivo principal</option>{devices.map((item) => <option key={item}>{item}</option>)}
          </select>
          <input value={form.extraDevicesCsv} onChange={(e) => setForm((p) => ({ ...p, extraDevicesCsv: e.target.value }))} placeholder="Dispositivos extra (csv)" className="rounded border border-slate-700 bg-slate-950 px-3 py-2" />
          <select value={form.rangeMode} onChange={(e) => setForm((p) => ({ ...p, rangeMode: e.target.value }))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2">
            <option value="last_7_days">Últimos 7 días</option><option value="previous_full_month">Mes completo anterior</option><option value="last_30_days">Últimos 30 días</option>
          </select>
          <select value={form.frequency} onChange={(e) => setForm((p) => ({ ...p, frequency: e.target.value }))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2">
            <option value="daily">Diario</option><option value="weekly">Semanal</option><option value="monthly">Mensual</option>
          </select>
          <input type="time" value={form.time} onChange={(e) => setForm((p) => ({ ...p, time: e.target.value }))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2" />
          {form.frequency === "weekly" && (
            <select value={form.weekday} onChange={(e) => setForm((p) => ({ ...p, weekday: e.target.value }))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2">
              <option value="0">Domingo</option><option value="1">Lunes</option><option value="2">Martes</option><option value="3">Miércoles</option><option value="4">Jueves</option><option value="5">Viernes</option><option value="6">Sábado</option>
            </select>
          )}
          <input value={form.emailsCsv} onChange={(e) => setForm((p) => ({ ...p, emailsCsv: e.target.value }))} placeholder="emails destino (csv)" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 md:col-span-2" />
          <button disabled={busy || !token} className="rounded bg-emerald-600 px-4 py-2 text-sm" type="submit">Guardar tarea</button>
        </form>
      )}

      {tab === "tasks" && (
        <div className="overflow-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-left"><tr><th className="px-3 py-2">Tarea</th><th className="px-3 py-2">Horario</th><th className="px-3 py-2">Emails</th><th className="px-3 py-2">Enabled</th><th className="px-3 py-2">Acciones</th></tr></thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="border-t border-slate-800">
                  <td className="px-3 py-2">{task.site} ({task.device})</td>
                  <td className="px-3 py-2">{task.frequency} {task.time}</td>
                  <td className="px-3 py-2">{(task.emails || []).join(", ")}</td>
                  <td className="px-3 py-2"><button className="rounded bg-slate-700 px-2 py-1" onClick={() => toggleTaskEnabled(task)}>{task.enabled ? "On" : "Off"}</button></td>
                  <td className="space-x-2 px-3 py-2">
                    <button className="rounded bg-blue-700 px-2 py-1" onClick={() => runTask(task.id)}>Ejecutar ahora</button>
                    <button className="rounded bg-red-700 px-2 py-1" onClick={() => removeTask(task.id)}>Borrar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "smtp" && (
        <div className="grid gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4 md:grid-cols-2">
          <input value={smtp.server} onChange={(e) => setSmtp((p) => ({ ...p, server: e.target.value }))} placeholder="host" className="rounded border border-slate-700 bg-slate-950 px-3 py-2" />
          <input type="number" value={smtp.port} onChange={(e) => setSmtp((p) => ({ ...p, port: Number(e.target.value) }))} placeholder="port" className="rounded border border-slate-700 bg-slate-950 px-3 py-2" />
          <input value={smtp.user} onChange={(e) => setSmtp((p) => ({ ...p, user: e.target.value }))} placeholder="user" className="rounded border border-slate-700 bg-slate-950 px-3 py-2" />
          <input type="password" value={smtp.password} onChange={(e) => setSmtp((p) => ({ ...p, password: e.target.value }))} placeholder="password (vacío conserva actual)" className="rounded border border-slate-700 bg-slate-950 px-3 py-2" />
          <div className="space-x-2 md:col-span-2">
            <button disabled={busy || !token} className="rounded bg-emerald-700 px-3 py-2" onClick={saveSmtp} type="button">Guardar SMTP</button>
            <input value={testRecipient} onChange={(e) => setTestRecipient(e.target.value)} placeholder="destinatario test" className="rounded border border-slate-700 bg-slate-950 px-3 py-2" />
            <button disabled={!testRecipient || !token} className="rounded bg-blue-700 px-3 py-2" onClick={sendSmtpTest} type="button">Enviar test</button>
          </div>
        </div>
      )}
    </section>
  );
}
