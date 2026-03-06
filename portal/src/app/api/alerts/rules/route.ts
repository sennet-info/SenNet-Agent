import { NextRequest } from "next/server";

import { requireAdminToken } from "@/lib/alerts-auth";
import { listRules, saveRules } from "@/lib/alerts-store";
import { normalizeRule } from "@/lib/alerts-validate";

export async function GET(request: NextRequest) {
  try {
    await requireAdminToken(request);
    return Response.json({ items: await listRules() });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "Error" }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdminToken(request);
    const payload = await request.json();
    const rules = await listRules();
    const rule = normalizeRule(payload);
    await saveRules([rule, ...rules]);
    return Response.json({ ok: true, item: rule });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "Error" }, { status: 400 });
  }
}
