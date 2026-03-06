import { NextRequest } from "next/server";

import { requireAdminToken } from "@/lib/alerts-auth";
import { updateEvent } from "@/lib/alerts-store";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdminToken(request);
    const event = await updateEvent(params.id, "resolved");
    if (!event) return Response.json({ detail: "Evento no encontrado" }, { status: 404 });
    return Response.json({ ok: true, item: event });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "Error" }, { status: 401 });
  }
}
