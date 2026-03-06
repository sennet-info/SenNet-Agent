export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { requireAdminToken } from "@/lib/alerts-auth";
import { listRules, saveRules } from "@/lib/alerts-store";
import { normalizeRule } from "@/lib/alerts-validate";

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdminToken(request);
    const payload = await request.json();
    const rules = await listRules();
    const idx = rules.findIndex((item) => item.id === params.id);
    if (idx < 0) return Response.json({ detail: "Regla no encontrada" }, { status: 404 });
    const updated = normalizeRule(payload, rules[idx]);
    rules[idx] = updated;
    await saveRules(rules);
    return Response.json({ ok: true, item: updated });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "Error" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdminToken(request);
    const rules = await listRules();
    await saveRules(rules.filter((item) => item.id !== params.id));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "Error" }, { status: 400 });
  }
}
