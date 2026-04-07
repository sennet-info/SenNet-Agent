export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { requireAdminToken } from "@/lib/alerts-auth";
import { clearEvents, listEvents } from "@/lib/alerts-store";

export async function GET(request: NextRequest) {
  try {
    await requireAdminToken(request);
    const severity = request.nextUrl.searchParams.get("severity") ?? "";
    const text = request.nextUrl.searchParams.get("q")?.toLowerCase() ?? "";
    const ruleId = request.nextUrl.searchParams.get("ruleId") ?? "";
    const tenant = request.nextUrl.searchParams.get("tenant") ?? "";
    const site = request.nextUrl.searchParams.get("site") ?? "";

    const items = (await listEvents()).filter((item) => {
      if (severity && item.severity !== severity) return false;
      if (ruleId && item.ruleId !== ruleId) return false;
      if (tenant && item.scope.tenant !== tenant) return false;
      if (site && item.scope.site !== site) return false;
      if (text && !`${item.message} ${item.ruleName}`.toLowerCase().includes(text)) return false;
      return true;
    });

    return Response.json({ items });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "Error" }, { status: 401 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdminToken(request);
    const onlyResolved = request.nextUrl.searchParams.get("onlyResolved") === "1";
    const result = await clearEvents({ onlyResolved });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "Error" }, { status: 401 });
  }
}
