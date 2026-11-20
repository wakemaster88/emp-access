import { NextRequest, NextResponse } from "next/server";
import { badRequest, notFound, stocktakeLinesSchema, wawiSession } from "@/lib/warenwirtschaft-server";
import { applyLineChanges } from "@/lib/stocktake-audit";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/warenwirtschaft/stocktakes/[id]/lines – Zählmengen speichern (nur
 * offene Inventur). Jede Änderung steht mit Login, Zeit, alt und neu im
 * Protokoll; vorhandene Bestätigungen werden dadurch aufgehoben.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const parsed = stocktakeLinesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.flatten());
  const st = await s.db.stocktake.findFirst({ where: { id, accountId: s.accountId }, select: { status: true } });
  if (!st) return notFound("Inventur");
  if (st.status !== "OPEN") return NextResponse.json({ error: "Inventur ist festgeschrieben" }, { status: 409 });
  const changed = await applyLineChanges(s.db, id, s.accountId, { name: s.userName, adminId: s.adminId, via: "app" }, parsed.data.lines);
  return NextResponse.json({ ok: true, changed });
}
