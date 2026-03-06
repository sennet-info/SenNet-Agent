import { NextRequest } from "next/server";

const AGENT_BASE_URL = process.env.AGENT_BASE_URL ?? "http://127.0.0.1:8000";

export async function requireAdminToken(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    throw new Error("Token Bearer requerido");
  }

  const resp = await fetch(`${AGENT_BASE_URL.replace(/\/$/, "")}/v1/admin/tenants`, {
    headers: { Authorization: auth },
    cache: "no-store",
  });
  if (!resp.ok) {
    throw new Error("Token admin inválido");
  }
  return auth;
}
