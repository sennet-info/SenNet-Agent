export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { requireAdminToken } from "@/lib/alerts-auth";
import { deleteEvent } from "@/lib/alerts-store";

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdminToken(request);
    const item = await deleteEvent(params.id);
    if (!item) return Response.json({ detail: "Evento no encontrado" }, { status: 404 });
    return Response.json({ ok: true, item });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "Error" }, { status: 401 });
  }
}
