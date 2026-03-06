export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { requireAdminToken } from "@/lib/alerts-auth";

const AGENT_BASE_URL = process.env.AGENT_BASE_URL ?? "http://127.0.0.1:8000";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminToken(request);
    const tenant = request.nextUrl.searchParams.get("tenant") ?? "";
    const client = request.nextUrl.searchParams.get("client") ?? "";
    if (!tenant || !client) return Response.json({ detail: "tenant y client requeridos" }, { status: 400 });

    const upstream = await fetch(`${AGENT_BASE_URL.replace(/\/$/, "")}/v1/discovery/sites?tenant=${encodeURIComponent(tenant)}&client=${encodeURIComponent(client)}`, {
      headers: { Authorization: auth },
      cache: "no-store",
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return Response.json({ detail: data?.detail ?? "Error discovery sites" }, { status: upstream.status });
    return Response.json({ items: Array.isArray(data.items) ? data.items : [] });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "Error" }, { status: 401 });
  }
}
