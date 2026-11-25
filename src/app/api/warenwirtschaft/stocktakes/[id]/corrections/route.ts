import { NextRequest, NextResponse } from "next/server";
import { badRequest, notFound, stocktakeCorrectionSchema, wawiSession } from "@/lib/warenwirtschaft-server";
import { logEvents } from "@/lib/stocktake-audit";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/warenwirtschaft/stocktakes/[id]/corrections – Korrektur einer
 * festgeschriebenen Inventur (GoBD: Änderung nur nachvollziehbar). Ändert
 * genau ein Feld einer Zeile und schreibt Person, Zeit, alten und neuen Wert
 * und die Begründung ins Protokoll. Der aktuelle Artikelbestand bleibt
 * unverändert (es kann schon spätere Zählungen geben).
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const s = await wawiSession({ requireAdmin: true });
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const parsed = stocktakeCorrectionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.flatten());
  const { lineId, field, reason } = parsed.data;
  const value = field === "purchasePriceCents" && parsed.data.value != null ? Math.round(parsed.data.value) : parsed.data.value;

  const st = await s.db.stocktake.findFirst({ where: { id, accountId: s.accountId }, select: { status: true } });
  if (!st) return notFound("Inventur");
  if (st.status !== "CLOSED") return NextResponse.json({ error: "Offene Inventuren direkt in der Liste ändern" }, { status: 409 });

  const line = await s.db.stocktakeLine.findFirst({
    where: { id: lineId, stocktakeId: id, accountId: s.accountId },
    select: { id: true, name: true, counted: true, broken: true, purchasePriceCents: true },
  });
  if (!line) return notFound("Zeile");
  const old = line[field];
  if (old === value) return NextResponse.json({ error: "Der Wert ist unverändert" }, { status: 400 });

  await s.db.stocktakeLine.updateMany({ where: { id: lineId, stocktakeId: id, accountId: s.accountId }, data: { [field]: value } });
  await logEvents(s.db, id, s.accountId, { name: s.userName, adminId: s.adminId, via: "app" }, [
    { type: "CORRECTION", lineId, lineName: line.name, field, oldValue: old, newValue: value, note: reason },
  ]);
  return NextResponse.json({ ok: true });
}
