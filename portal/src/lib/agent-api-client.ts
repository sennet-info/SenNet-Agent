import { DebugPayload } from "@/lib/agent-types";
export type TenantConfig = {
  url: string;
  token: string;
  org: string;
  bucket: string;
};

export type PriceSource = "serial" | "site" | "client" | "tenant" | "fallback" | "manual_override";

export type PricingDefaults = {
  fallback: number;
  scopes: {
    serial: Record<string, number>;
    site: Record<string, number>;
    client: Record<string, number>;
    tenant: Record<string, number>;
  };
};

export type ReportPayload = {
  tenant: string;
  client: string;
  site: string;
  serial?: string;
  devices: string[];
  range_flux: string;
  range_mode?: "last_n_days" | "month_to_date" | "previous_full_month" | "custom" | "last_days" | "full_month";
  last_days?: number;
  range_label?: string;
  timezone?: string;
  price: number;
  price_source?: PriceSource;
  price_override?: boolean;
  start_dt?: string;
  end_dt?: string;
  debug?: boolean;
  debug_sample_n?: number;
  max_workers?: number;
  force_recalculate?: boolean;
  report_options?: {
    palette?: string;
    show_profile?: boolean;
    show_summary?: boolean;
    show_prev?: boolean;
    show_heatmap?: boolean;
    show_cumulative?: boolean;
    show_top_days?: boolean;
  };
};

export type SchedulerTaskPayload = {
  tenant: string;
  client: string;
  site: string;
  serial?: string;
  device: string;
  extra_devices?: string[];
  frequency: "daily" | "weekly" | "monthly" | "cron";
  time: string;
  weekday?: number;
  cron?: string;
  report_range_mode?: string;
  range_flux?: string;
  start_dt?: string;
  end_dt?: string;
  emails: string[];
  enabled?: boolean;
  name?: string;
  report_options?: {
    palette?: string;
    show_profile?: boolean;
    show_summary?: boolean;
    show_prev?: boolean;
    show_heatmap?: boolean;
    show_cumulative?: boolean;
    show_top_days?: boolean;
  };
};

export type SchedulerTask = SchedulerTaskPayload & {
  id: string;
  tenant_alias?: string;
  created_at?: string;
  last_run?: string;
  last_run_ts?: string;
  last_email_sent_at?: string;
  last_status?: "pending" | "running" | "ok" | "error";
  last_error?: string | null;
  last_duration_ms?: number;
  in_progress_run_id?: string | null;
};


export type SchedulerRunPayload = {
  debug?: boolean;
  debug_sample_n?: number;
  force_recalculate?: boolean;
  send_email?: boolean;
};

export type SchedulerRunResult = {
  ok: boolean;
  pdf_path: string;
  filename: string;
  sender_path?: string;
  email_sent: boolean;
  email_recipients: string[];
  email_detail: string;
  debug_path?: string | null;
  debug?: DebugPayload | null;
};

export type SmtpConfigPayload = {
  server: string;
  port: number;
  user: string;
  password: string;
};

export type ReportResult = {
  pdf_path: string;
  filename: string;
  debug_path?: string | null;
  debug?: DebugPayload | null;
};

const DEFAULT_BASE = process.env.NEXT_PUBLIC_PORTAL_AGENT_API_BASE ?? process.env.PORTAL_AGENT_API_BASE ?? "/api/agent";

function buildUrl(path: string, query?: Record<string, string | undefined>) {
  const base = DEFAULT_BASE.replace(/\/$/, "");
  const url = new URL(`${base}${path}`, "http://portal.local");

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
  }

  return url.pathname + url.search;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : "Error inesperado";
    throw new Error(detail);
  }
  return data as T;
}

export async function getHealth() {
  const response = await fetch(buildUrl("/v1/health"), { cache: "no-store" });
  return parseJsonResponse<{ ok: boolean }>(response);
}

export async function discoveryClients(tenant: string) {
  const response = await fetch(buildUrl("/v1/discovery/clients", { tenant }), { cache: "no-store" });
  return parseJsonResponse<{ items: string[] }>(response);
}

export async function discoverySites(tenant: string, client: string) {
  const response = await fetch(buildUrl("/v1/discovery/sites", { tenant, client }), { cache: "no-store" });
  return parseJsonResponse<{ items: string[] }>(response);
}

export async function discoverySerials(tenant: string, client: string, site: string) {
  const response = await fetch(buildUrl("/v1/discovery/serials", { tenant, client, site }), { cache: "no-store" });
  return parseJsonResponse<{ items: string[] }>(response);
}

export async function discoveryDevices(tenant: string, client: string, site: string, serial?: string) {
  const response = await fetch(buildUrl("/v1/discovery/devices", { tenant, client, site, serial }), {
    cache: "no-store",
  });
  return parseJsonResponse<{ items: string[] }>(response);
}


export async function resolveDefaultPrice(tenant: string, client?: string, site?: string, serial?: string) {
  const response = await fetch(buildUrl("/v1/pricing/resolve", { tenant, client, site, serial }), { cache: "no-store" });
  return parseJsonResponse<{
    price: number;
    source: PriceSource;
    scope: { tenant: string; client?: string; site?: string; serial?: string };
    matched_key?: string | null;
  }>(response);
}

export async function adminGetPricingDefaults(token: string) {
  const response = await fetch(buildUrl("/v1/pricing/defaults"), {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJsonResponse<{ item: PricingDefaults }>(response);
}

export async function adminPutPricingDefaults(token: string, payload: PricingDefaults) {
  const response = await fetch(buildUrl("/v1/pricing/defaults"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<{ ok: boolean; item: PricingDefaults }>(response);
}

export async function createReport(payload: ReportPayload) {
  const response = await fetch(buildUrl("/v1/reports"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<ReportResult>(response);
}

export function downloadUrl(pdfPath: string) {
  return buildUrl("/v1/reports/download", { path: pdfPath });
}

export function downloadDebugUrl(debugPath: string) {
  return buildUrl("/v1/reports/download-debug", { path: debugPath });
}

export async function schedulerListTasks(token?: string) {
  const response = await fetch(buildUrl("/v1/scheduler/tasks"), {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return parseJsonResponse<{ items: SchedulerTask[] }>(response);
}

export async function schedulerCreateTask(token: string, payload: SchedulerTaskPayload) {
  const response = await fetch(buildUrl("/v1/scheduler/tasks"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<{ ok: boolean; task: SchedulerTask }>(response);
}

export async function schedulerUpdateTask(token: string, taskId: string, payload: Partial<SchedulerTaskPayload> & { enabled?: boolean }) {
  const response = await fetch(buildUrl(`/v1/scheduler/tasks/${encodeURIComponent(taskId)}`), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<{ ok: boolean; task: SchedulerTask }>(response);
}

export async function schedulerDeleteTask(token: string, taskId: string) {
  const response = await fetch(buildUrl(`/v1/scheduler/tasks/${encodeURIComponent(taskId)}`), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJsonResponse<{ ok: boolean }>(response);
}

export async function schedulerRunTask(token: string, taskId: string, payload: SchedulerRunPayload = {}) {
  const response = await fetch(buildUrl(`/v1/scheduler/tasks/${encodeURIComponent(taskId)}/run`), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<SchedulerRunResult>(response);
}

export async function schedulerGetSmtp(token: string) {
  const response = await fetch(buildUrl("/v1/scheduler/smtp"), {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJsonResponse<{ item: SmtpConfigPayload }>(response);
}

export async function schedulerPutSmtp(token: string, payload: SmtpConfigPayload) {
  const response = await fetch(buildUrl("/v1/scheduler/smtp"), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<{ ok: boolean; item: SmtpConfigPayload }>(response);
}

export async function schedulerTestSmtp(token: string, recipient: string) {
  const response = await fetch(buildUrl("/v1/scheduler/smtp/test"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient }),
  });
  return parseJsonResponse<{ ok: boolean; detail: string }>(response);
}

export async function adminListTenants(token: string) {
  const response = await fetch(buildUrl("/v1/admin/tenants"), {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJsonResponse<{ items: Record<string, TenantConfig> }>(response);
}

export async function adminPutTenant(token: string, alias: string, payload: TenantConfig) {
  const response = await fetch(buildUrl(`/v1/admin/tenants/${encodeURIComponent(alias)}`), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<{ ok: boolean }>(response);
}

export async function adminDeleteTenant(token: string, alias: string) {
  const response = await fetch(buildUrl(`/v1/admin/tenants/${encodeURIComponent(alias)}`), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJsonResponse<{ ok: boolean }>(response);
}

export async function adminListRoles(token: string) {
  const response = await fetch(buildUrl("/v1/admin/roles"), {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJsonResponse<{ items: Record<string, string>; role_options: string[] }>(response);
}

export async function adminPutRole(token: string, device: string, role: string) {
  const response = await fetch(buildUrl(`/v1/admin/roles/${encodeURIComponent(device)}`), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role }),
  });
  return parseJsonResponse<{ ok: boolean }>(response);
}

export async function adminDeleteRole(token: string, device: string) {
  const response = await fetch(buildUrl(`/v1/admin/roles/${encodeURIComponent(device)}`), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJsonResponse<{ ok: boolean }>(response);
}
