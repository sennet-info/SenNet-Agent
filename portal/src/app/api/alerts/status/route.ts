import { NextRequest } from "next/server";

import { requireAdminToken } from "@/lib/alerts-auth";
import { getState } from "@/lib/alerts-store";

export async function GET(request: NextRequest) {
  try {
    await requireAdminToken(request);
    return Response.json({ item: await getState() });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "Error" }, { status: 401 });
  }
}
