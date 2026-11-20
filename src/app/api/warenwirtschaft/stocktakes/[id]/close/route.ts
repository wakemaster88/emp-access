import { NextRequest, NextResponse } from "next/server";
import { notFound, wawiSession } from "@/lib/warenwirtschaft-server";
import { ROLE_LABEL, signatureStatus } from "@/lib/stocktake-log";
import { logEvents, stocktakeHash } from "@/lib/stocktake-audit";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/warenwirtschaft/stocktakes/[id]/close – Inventur abschließen.
 * Nur, wenn Zähler und Schreiber den aktuellen Stand bestätigt haben.
 * Übernimmt jede gezählte Menge als neuen Artikelbestand und schreibt die
 * Inventur fest; danach ändert sie nur noch eine begründete Korrektur.
 * Ungezählte Zeilen behalten ihren Bestand; bei der Stichtagsinventur
 * zählen sie mit 0 nicht mit.
 */
export async function POST(_request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const st = await s.db.stocktake.findFirst({
    where: { id, accountId: s.accountId },
    select: {
      status: true,
      lines: { select: { articleId: true, counted: true } },
      signatures: { select: { role: true, adminId: true, name: true, contentHash: true } },
    },
  });
  if (!st) return notFound("Inventur");
  if (st.status !== "OPEN") return NextResponse.json({ error: "Inventur ist schon festgeschrieben" }, { status: 409 });

  const sig = signatureStatus(st.signatures, await stocktakeHash(s.db, id, s.accountId));
  if (!sig.complete) {
    const missing = sig.missing.map((r) => ROLE_LABEL[r]).join(" und ");
    return NextResponse.json({ error: `Zum Festschreiben fehlt die Bestätigung durch ${missing}.` }, { status: 409 });
  }

  const counted = st.lines.filter((l) => l.articleId != null && l.counted != null);
  for (const l of counted) {
    await s.db.article.updateMany({ where: { id: l.articleId!, accountId: s.accountId }, data: { stock: l.counted! } });
  }
  const res = await s.db.stocktake.updateMany({
    where: { id, accountId: s.accountId, status: "OPEN" },
    // Zähl-Link verfällt mit dem Festschreiben.
    data: { status: "CLOSED", closedAt: new Date(), closedBy: s.userName.slice(0, 120), countToken: null, countTokenExpiresAt: null },
  });
  if (res.count === 1) {
    await logEvents(s.db, id, s.accountId, { name: s.userName, adminId: s.adminId, via: "app" }, [
      { type: "CLOSED", note: `${counted.length} Bestände übernommen` },
    ]);
  }
  return NextResponse.json({ ok: true, updated: counted.length });
}
