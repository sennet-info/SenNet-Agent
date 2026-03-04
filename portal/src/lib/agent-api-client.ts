export type TenantConfig = {
  url: string;
  token: string;
  org: string;
  bucket: string;
};

export type ReportPayload = {
  tenant: string;
  client: string;
  site: string;
  serial?: string;
  devices: string[];
  range_flux: string;
  price: number;
  start_dt?: string;
  end_dt?: string;
  debug?: boolean;
  debug_sample_n?: number;
  max_workers?: number;
  force_recalculate?: boolean;
};

export type ReportDebug = {
  inputs?: Record<string, unknown>;
  resolved_range?: Record<string, unknown>;
  query_proof?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  sample_rows?: Record<string, unknown>;
  timings_ms?: Record<string, unknown>;
  warnings?: string[];
};

export type ReportResult = {
  pdf_path: string;
  filename: string;
  debug_path?: string | null;
  debug?: ReportDebug | null;
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
