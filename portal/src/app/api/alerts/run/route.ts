import { NextRequest } from "next/server";

import { requireAdminToken } from "@/lib/alerts-auth";
import { runAllRules } from "@/lib/alerts-engine";

export async function POST(request: NextRequest) {
  try {
    await requireAdminToken(request);
    return Response.json(await runAllRules());
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "Error" }, { status: 401 });
  }
}
