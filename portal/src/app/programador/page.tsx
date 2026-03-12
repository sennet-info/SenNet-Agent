"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
  adminListTenants,
  discoveryClients,
  discoveryDevices,
  discoverySerials,
  discoverySites,
  downloadDebugUrl,
  downloadUrl,
  SchedulerRunResult,
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
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const WEEKDAY_OPTIONS = [
  { value: "0", label: "Domingo" },
  { value: "1", label: "Lunes" },
  { value: "2", label: "Martes" },
  { value: "3", label: "Miércoles" },
  { value: "4", label: "Jueves" },
  { value: "5", label: "Viernes" },
  { value: "6", label: "Sábado" },
];

const RANGE_COPY: Record<string, string> = {
  last_7_days: "Incluye los últimos 7 días desde la fecha de ejecución.",
  previous_full_month: "Genera el informe del mes cerrado anterior (mes completo).",
  last_30_days: "Incluye una ventana móvil de 30 días hasta la fecha de ejecución.",
};

function splitCsv(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toHumanFrequency(task: SchedulerTask) {
  if (task.frequency === "weekly") {
    const weekday = WEEKDAY_OPTIONS.find((item) => item.value === String(task.weekday ?? "1"))?.label ?? "día configurado";
    return `Semanal · ${weekday} a las ${task.time}`;
  }
  if (task.frequency === "monthly") return `Mensual · a las ${task.time}`;
  if (task.frequency === "daily") return `Diario · a las ${task.time}`;
  return `${task.frequency} · ${task.time}`;
}

function toHumanRange(rangeMode?: string) {
  if (rangeMode === "previous_full_month") return "Mes completo anterior";
  if (rangeMode === "last_30_days") return "Últimos 30 días";
  return "Últimos 7 días";
}

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
  const [emailInput, setEmailInput] = useState("");
  const [extraDeviceCandidate, setExtraDeviceCandidate] = useState("");
  const [lastDebugRun, setLastDebugRun] = useState<SchedulerRunResult | null>(null);
  const [debugCopied, setDebugCopied] = useState(false);

  const [form, setForm] = useState({
    name: "",
    tenant: "",
    client: "",
    site: "",
    serial: "",
    device: "",
    extraDevices: [] as string[],
    rangeMode: "last_7_days",
    startDt: "",
    endDt: "",
    frequency: "daily",
    weekday: "1",
    time: "08:00",
    emails: [] as string[],
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
    if (token) setOkMsg("Token cargado correctamente. Ya puedes configurar tareas automáticas.");
  }

  useEffect(() => {
    if (!form.tenant) {
      setClients([]);
      return;
    }
    discoveryClients(form.tenant).then((res) => setClients(res.items)).catch(() => setClients([]));
  }, [form.tenant]);

  useEffect(() => {
    if (!form.tenant || !form.client) {
      setSites([]);
      return;
    }
    discoverySites(form.tenant, form.client).then((res) => setSites(res.items)).catch(() => setSites([]));
  }, [form.tenant, form.client]);

  useEffect(() => {
    if (!form.tenant || !form.client || !form.site) {
      setSerials([]);
      setDevices([]);
      return;
    }
    discoverySerials(form.tenant, form.client, form.site).then((res) => setSerials(res.items)).catch(() => setSerials([]));
    discoveryDevices(form.tenant, form.client, form.site, form.serial || undefined)
      .then((res) => setDevices(res.items))
      .catch(() => setDevices([]));
  }, [form.tenant, form.client, form.site, form.serial]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      extraDevices: prev.extraDevices.filter((item) => item !== prev.device && devices.includes(item)),
    }));
  }, [form.device, devices]);

  const extraDevices = useMemo(() => form.extraDevices.filter(Boolean), [form.extraDevices]);
  const extraDeviceOptions = useMemo(
    () => devices.filter((item) => item !== form.device && !form.extraDevices.includes(item)),
    [devices, form.device, form.extraDevices],
  );
  const validEmails = useMemo(() => form.emails.filter((email) => EMAIL_REGEX.test(email)), [form.emails]);
  const invalidEmails = useMemo(() => form.emails.filter((email) => !EMAIL_REGEX.test(email)), [form.emails]);
  const pendingEmailValid = useMemo(() => (emailInput ? EMAIL_REGEX.test(emailInput.trim()) : true), [emailInput]);

  const canSubmit = Boolean(
    token &&
      form.tenant &&
      form.client &&
      form.site &&
      form.device &&
      form.time &&
      validEmails.length > 0 &&
      invalidEmails.length === 0,
  );

  function clearScopedFields(level: "tenant" | "client" | "site") {
    if (level === "tenant") {
      setForm((p) => ({ ...p, client: "", site: "", serial: "", device: "", extraDevices: [] }));
      setExtraDeviceCandidate("");
      return;
    }
    if (level === "client") {
      setForm((p) => ({ ...p, site: "", serial: "", device: "", extraDevices: [] }));
      setExtraDeviceCandidate("");
      return;
    }
    setForm((p) => ({ ...p, serial: "", device: "", extraDevices: [] }));
    setExtraDeviceCandidate("");
  }

  function addExtraDevice(deviceId: string) {
    if (!deviceId) return;
    setForm((prev) => {
      if (deviceId === prev.device || prev.extraDevices.includes(deviceId)) return prev;
      return { ...prev, extraDevices: [...prev.extraDevices, deviceId] };
    });
    setExtraDeviceCandidate("");
  }

  function removeExtraDevice(deviceId: string) {
    setForm((prev) => ({ ...prev, extraDevices: prev.extraDevices.filter((item) => item !== deviceId) }));
  }

  function addEmails(raw: string) {
    const entries = splitCsv(raw);
    if (!entries.length) return;
    setForm((prev) => {
      const merged = [...prev.emails];
      for (const entry of entries) {
        if (!merged.includes(entry)) merged.push(entry);
      }
      return { ...prev, emails: merged };
    });
  }

  function removeEmail(value: string) {
    setForm((prev) => ({ ...prev, emails: prev.emails.filter((item) => item !== value) }));
  }

  function pushEmailInput() {
    if (!emailInput.trim()) return;
    addEmails(emailInput);
    setEmailInput("");
  }

  function handleEmailKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      pushEmailInput();
    }
  }

  async function submitTask(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setOkMsg("");

    if (!form.site) {
      setError("Debes seleccionar una instalación");
      setBusy(false);
      return;
    }

    if (validEmails.length === 0) {
      setError("Añade al menos un correo válido");
      setBusy(false);
      return;
    }

    if (invalidEmails.length > 0) {
      setError("Hay correos inválidos. Revísalos antes de guardar la tarea.");
      setBusy(false);
      return;
    }

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
        emails: validEmails,
        enabled: true,
      });
      setOkMsg("La tarea se ha guardado correctamente");
      await initialLoad(token);
      setTab("tasks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la tarea. Revisa los campos marcados");
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

  async function runTask(taskId: string, withDebug = false) {
    try {
      setError("");
      const result = await schedulerRunTask(token, taskId, withDebug ? { debug: true, debug_sample_n: 10 } : {});
      setLastDebugRun(withDebug ? result : null);
      setDebugCopied(false);
      window.open(downloadUrl(result.pdf_path), "_blank");
      const recipients = result.email_recipients?.length ? result.email_recipients.join(", ") : "sin destinatarios";
      const delivery = result.email_sent ? "Email enviado" : "Email no enviado";
      const debugInfo = withDebug ? ` Debug: ${result.debug_path || "inline"}.` : "";
      setOkMsg(`Ejecución OK: ${result.filename}. ${delivery} (${recipients}). ${result.email_detail || ""}.${debugInfo}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo ejecutar");
    }
  }

  async function copyLastDebug() {
    if (!lastDebugRun?.debug) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastDebugRun.debug, null, 2));
      setDebugCopied(true);
      setTimeout(() => setDebugCopied(false), 1800);
    } catch {
      setError("No se pudo copiar el debug al portapapeles");
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

  const frequencySummary =
    form.frequency === "daily"
      ? `Todos los días a las ${form.time}`
      : form.frequency === "weekly"
        ? `Cada ${WEEKDAY_OPTIONS.find((day) => day.value === form.weekday)?.label?.toLowerCase()} a las ${form.time}`
        : `Una vez al mes a las ${form.time}`;

  return (
    <section className="space-y-6">
      <h2 className="text-3xl font-semibold tracking-tight">Programador de tareas automáticas</h2>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <label className="mb-2 block text-sm text-slate-300">Token admin (Bearer)</label>
        <div className="flex gap-2">
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
            placeholder="Pega aquí tu token para habilitar la carga de datos"
          />
          <button onClick={saveTokenAndLoad} className="rounded-md bg-blue-600 px-4 py-2 text-sm" type="button">
            Cargar
          </button>
        </div>
        {!token && <p className="mt-2 text-xs text-amber-300">Primero carga el token para consultar tenants, instalaciones y tareas activas.</p>}
      </div>

      <div className="flex gap-2">
        <button className={tabStyle("new")} onClick={() => setTab("new")}>Nueva tarea</button>
        <button className={tabStyle("tasks")} onClick={() => setTab("tasks")}>Tareas activas</button>
        <button className={tabStyle("smtp")} onClick={() => setTab("smtp")}>Configuración SMTP</button>
      </div>

      {error && <p className="rounded-md border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {okMsg && <p className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">{okMsg}</p>}

      {tab === "new" && (
        <form onSubmit={submitTask} className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="rounded-md border border-slate-800 p-4">
            <h3 className="text-lg font-medium">A. Alcance del informe</h3>
            <p className="mb-3 text-sm text-slate-400">Define para qué cliente e instalación se generará el informe automático.</p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-slate-200">Nombre de la tarea (opcional)</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Ej. Informe energía oficina central"
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
                />
                <span className="text-xs text-slate-400">Te ayudará a identificar esta tarea en el listado.</span>
              </label>

              <label className="space-y-1 text-sm">
                <span className="text-slate-200">Tenant</span>
                <select
                  value={form.tenant}
                  onChange={(e) => {
                    clearScopedFields("tenant");
                    setForm((p) => ({ ...p, tenant: e.target.value }));
                  }}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
                  disabled={!token}
                >
                  <option value="">Selecciona un tenant</option>
                  {tenantOptions.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-sm">
                <span className="text-slate-200">Cliente</span>
                <select
                  value={form.client}
                  onChange={(e) => {
                    clearScopedFields("client");
                    setForm((p) => ({ ...p, client: e.target.value }));
                  }}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
                  disabled={!form.tenant}
                >
                  <option value="">{form.tenant ? "Selecciona un cliente" : "Primero selecciona un tenant"}</option>
                  {clients.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-sm">
                <span className="text-slate-200">Instalación</span>
                <select
                  value={form.site}
                  onChange={(e) => {
                    clearScopedFields("site");
                    setForm((p) => ({ ...p, site: e.target.value }));
                  }}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
                  disabled={!form.client}
                >
                  <option value="">{form.client ? "Selecciona una instalación" : "Primero selecciona un cliente"}</option>
                  {sites.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-sm">
                <span className="text-slate-200">Equipo / gateway (opcional)</span>
                <select
                  value={form.serial}
                  onChange={(e) => setForm((p) => ({ ...p, serial: e.target.value }))}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
                  disabled={!form.site}
                >
                  <option value="">{form.site ? "Sin filtro por equipo / gateway" : "Primero selecciona una instalación"}</option>
                  {serials.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <span className="text-xs text-slate-400">Es opcional y sirve para acotar mejor la búsqueda de dispositivos.</span>
              </label>

              <label className="space-y-1 text-sm">
                <span className="text-slate-200">Dispositivo principal del informe</span>
                <select
                  value={form.device}
                  onChange={(e) => setForm((p) => ({ ...p, device: e.target.value }))}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
                  disabled={!form.site}
                >
                  <option value="">{form.site ? "Selecciona un dispositivo" : "Primero selecciona una instalación"}</option>
                  {devices.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <span className="text-xs text-slate-400">Si eliges solo este campo, el informe se centrará en este equipo.</span>
              </label>

              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-slate-200">Otros dispositivos a incluir</span>
                <div className="flex flex-col gap-2 md:flex-row">
                  <select
                    value={extraDeviceCandidate}
                    onChange={(e) => setExtraDeviceCandidate(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
                    disabled={!form.site || !extraDeviceOptions.length}
                  >
                    <option value="">
                      {!form.site
                        ? "Primero selecciona una instalación"
                        : extraDeviceOptions.length
                          ? "Selecciona otro dispositivo"
                          : "No hay más dispositivos disponibles"}
                    </option>
                    {extraDeviceOptions.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => addExtraDevice(extraDeviceCandidate)}
                    className="rounded bg-slate-700 px-3 py-2 text-sm disabled:opacity-50"
                    disabled={!extraDeviceCandidate}
                  >
                    Añadir
                  </button>
                </div>
                <span className="text-xs text-slate-400">Selecciona los dispositivos extra desde el desplegable para incluirlos en el mismo informe.</span>
                {!!extraDevices.length && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {extraDevices.map((item) => (
                      <span key={item} className="inline-flex items-center gap-2 rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1 text-xs text-blue-300">
                        {item}
                        <button type="button" className="font-bold leading-none" onClick={() => removeExtraDevice(item)}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </label>
            </div>
          </div>

          <div className="rounded-md border border-slate-800 p-4">
            <h3 className="text-lg font-medium">B. Contenido del informe</h3>
            <p className="mb-3 text-sm text-slate-400">Selecciona qué periodo cubrirá cada ejecución.</p>
            <label className="space-y-1 text-sm">
              <span className="text-slate-200">Periodo del informe</span>
              <select
                value={form.rangeMode}
                onChange={(e) => setForm((p) => ({ ...p, rangeMode: e.target.value }))}
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 md:w-96"
              >
                <option value="last_7_days">Últimos 7 días</option>
                <option value="previous_full_month">Mes completo anterior</option>
                <option value="last_30_days">Últimos 30 días</option>
              </select>
              <span className="text-xs text-slate-400">{RANGE_COPY[form.rangeMode] ?? "Selecciona un rango válido."}</span>
            </label>
          </div>

          <div className="rounded-md border border-slate-800 p-4">
            <h3 className="text-lg font-medium">C. Programación</h3>
            <p className="mb-3 text-sm text-slate-400">Define cada cuánto se envía y en qué momento se ejecuta.</p>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="text-slate-200">Frecuencia</span>
                <select
                  value={form.frequency}
                  onChange={(e) => setForm((p) => ({ ...p, frequency: e.target.value }))}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
                >
                  <option value="daily">Diario</option>
                  <option value="weekly">Semanal</option>
                  <option value="monthly">Mensual</option>
                </select>
              </label>

              {form.frequency === "weekly" && (
                <label className="space-y-1 text-sm">
                  <span className="text-slate-200">Día de la semana</span>
                  <select
                    value={form.weekday}
                    onChange={(e) => setForm((p) => ({ ...p, weekday: e.target.value }))}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
                  >
                    {WEEKDAY_OPTIONS.map((day) => (
                      <option key={day.value} value={day.value}>{day.label}</option>
                    ))}
                  </select>
                </label>
              )}

              <label className="space-y-1 text-sm">
                <span className="text-slate-200">Hora de ejecución</span>
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm((p) => ({ ...p, time: e.target.value }))}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>
            </div>
            <div className="mt-2 rounded border border-slate-700 bg-slate-950/40 p-3 text-xs text-slate-300">
              <p>• Diario: se ejecuta todos los días a la hora indicada.</p>
              <p>• Semanal: se ejecuta el día elegido a la hora indicada.</p>
              <p>• Mensual: se ejecuta una vez al mes a la hora indicada (el día exacto lo determina la lógica del backend).</p>
            </div>
          </div>

          <div className="rounded-md border border-slate-800 p-4">
            <h3 className="text-lg font-medium">D. Destinatarios</h3>
            <p className="mb-3 text-sm text-slate-400">Introduce uno o varios correos para el envío automático.</p>
            <label className="space-y-1 text-sm">
              <span className="text-slate-200">Correos de destino</span>
              <input
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={handleEmailKeyDown}
                onBlur={pushEmailInput}
                placeholder="Escribe un correo y pulsa Enter o coma"
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              />
              <span className="text-xs text-slate-400">Escribe varios correos separados por comas. Ejemplo: usuario1@empresa.com, usuario2@empresa.com.</span>
            </label>

            {!!form.emails.length && (
              <div className="mt-3 flex flex-wrap gap-2">
                {form.emails.map((email) => {
                  const isValid = EMAIL_REGEX.test(email);
                  return (
                    <span
                      key={email}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${isValid ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"}`}
                    >
                      {email}
                      <button type="button" onClick={() => removeEmail(email)} className="font-bold leading-none">×</button>
                    </span>
                  );
                })}
              </div>
            )}

            {!pendingEmailValid && <p className="mt-2 text-xs text-red-300">El correo en edición no parece válido.</p>}
            {!!invalidEmails.length && <p className="mt-2 text-xs text-red-300">Hay correos inválidos marcados en rojo. Corrígelos o elimínalos.</p>}
          </div>

          <div className="rounded-md border border-blue-500/40 bg-blue-500/10 p-4 text-sm">
            <h3 className="font-medium text-blue-200">E. Resumen antes de guardar</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-200">
              <li>Se programará un informe para la instalación <strong>{form.site || "(sin seleccionar)"}</strong>.</li>
              <li>Dispositivo principal: <strong>{form.device || "(sin seleccionar)"}</strong>{extraDevices.length ? ` + ${extraDevices.length} dispositivos extra` : ""}.</li>
              <li>Periodicidad: <strong>{frequencySummary}</strong>.</li>
              <li>Periodo del informe: <strong>{toHumanRange(form.rangeMode)}</strong>.</li>
              <li>Destinatarios: <strong>{validEmails.join(", ") || "(sin correos válidos)"}</strong>.</li>
            </ul>
          </div>

          <button disabled={busy || !canSubmit} className="rounded bg-emerald-600 px-4 py-2 text-sm disabled:opacity-50" type="submit">
            Guardar tarea
          </button>
        </form>
      )}

      {tab === "tasks" && (
        <div className="overflow-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-left">
              <tr>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Instalación</th>
                <th className="px-3 py-2">Dispositivos / alcance</th>
                <th className="px-3 py-2">Periodo</th>
                <th className="px-3 py-2">Programación</th>
                <th className="px-3 py-2">Destinatarios</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="border-t border-slate-800 align-top">
                  <td className="px-3 py-2">{task.name || "Sin nombre"}</td>
                  <td className="px-3 py-2">{task.site}</td>
                  <td className="px-3 py-2">
                    <div className="space-y-1">
                      <div><strong>Principal:</strong> {task.device}</div>
                      {task.serial ? <div className="text-xs text-slate-300"><strong>Serial:</strong> {task.serial}</div> : null}
                      {task.extra_devices?.length ? (
                        <div className="text-xs text-slate-300" title={task.extra_devices.join(", ")}>
                          <strong>Extra:</strong> {task.extra_devices.join(", ")}
                        </div>
                      ) : null}
                      <div className="text-xs text-slate-400">
                        Alcance esperado: {task.tenant_alias} / {task.client} / {task.site}{task.serial ? ` / ${task.serial}` : ""}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">{toHumanRange(task.report_range_mode)}</td>
                  <td className="px-3 py-2">{toHumanFrequency(task)}</td>
                  <td className="px-3 py-2">{(task.emails || []).join(", ")}</td>
                  <td className="px-3 py-2">
                    <button
                      className={`rounded px-2 py-1 text-xs ${task.enabled ? "bg-emerald-700" : "bg-slate-700"}`}
                      onClick={() => toggleTaskEnabled(task)}
                    >
                      {task.enabled ? "Activa" : "Inactiva"}
                    </button>
                  </td>
                  <td className="space-x-2 px-3 py-2">
                    <button className="rounded bg-blue-700 px-2 py-1" onClick={() => runTask(task.id)}>Ejecutar ahora</button>
                    <button className="rounded bg-indigo-700 px-2 py-1" onClick={() => runTask(task.id, true)}>Ejecutar con debug</button>
                    <button className="rounded bg-red-700 px-2 py-1" onClick={() => removeTask(task.id)}>Borrar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "tasks" && lastDebugRun?.debug && (
        <div className="mt-4 rounded-lg border border-indigo-700/60 bg-slate-950/80 p-4 text-xs text-slate-200">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <strong className="text-indigo-300">Última ejecución debug</strong>
            {lastDebugRun.debug_path ? (
              <a
                className="rounded bg-indigo-600 px-2 py-1 text-white"
                href={downloadDebugUrl(lastDebugRun.debug_path)}
                target="_blank"
                rel="noreferrer"
              >
                Descargar debug.json
              </a>
            ) : null}
            <button
              className="rounded bg-slate-700 px-2 py-1 text-white"
              type="button"
              onClick={copyLastDebug}
            >
              Copiar debug
            </button>
            {debugCopied ? <span className="text-emerald-300">Copiado ✓</span> : null}
          </div>
          <div className="mb-2 text-slate-400">
            Revisa aquí el flujo real ejecutado (devices, rango, pricing, query trace y delivery).
          </div>
          <pre className="max-h-80 overflow-auto rounded bg-black/40 p-2">
            {JSON.stringify(lastDebugRun.debug, null, 2)}
          </pre>
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
