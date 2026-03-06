import { NextRequest } from "next/server";

import { requireAdminToken } from "@/lib/alerts-auth";
import { evaluateRule } from "@/lib/alerts-engine";
import { listRules } from "@/lib/alerts-store";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdminToken(request);
    const rules = await listRules();
    const rule = rules.find((item) => item.id === params.id);
    if (!rule) return Response.json({ detail: "Regla no encontrada" }, { status: 404 });
    const result = await evaluateRule(rule, true);
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "Error" }, { status: 400 });
  }
}
