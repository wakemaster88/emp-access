import { NextRequest, NextResponse } from "next/server";
import { notFound, wawiSession } from "@/lib/warenwirtschaft-server";
import { ROLE_LABEL, signatureStatus, signersBlockedReason } from "@/lib/stocktake-log";
import { hashContent, logEvents, stocktakeHash } from "@/lib/stocktake-audit";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/warenwirtschaft/stocktakes/[id]/close – Inventur abschließen.
 * Nur, wenn Zähler und Schreiber (zwei verschiedene Logins) den aktuellen
 * Stand bestätigt haben.
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
      signatures: { select: { role: true, adminId: true, name: true, contentHash: true } },
    },
  });
  if (!st) return notFound("Inventur");
  if (st.status !== "OPEN") return NextResponse.json({ error: "Inventur ist schon festgeschrieben" }, { status: 409 });

  const currentHash = await stocktakeHash(s.db, id, s.accountId);
  const sig = signatureStatus(st.signatures, currentHash);
  if (!sig.complete) {
    const missing = sig.missing.map((r) => ROLE_LABEL[r]).join(" und ");
    return NextResponse.json({ error: `Zum Festschreiben fehlt die Bestätigung durch ${missing}.` }, { status: 409 });
  }

  const blocked = signersBlockedReason(sig.valid);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

  // Status und Bestände in einer Transaktion: erst den Status (nur aus OPEN),
  // dann alle gezählten Mengen mit einer Anweisung. Scheitert etwas, bleibt
  // die Inventur offen und kein Bestand ist geändert.
  let updated: number;
  try {
    updated = await s.db.$transaction(async (tx) => {
      const res = await tx.stocktake.updateMany({
        where: { id, accountId: s.accountId, status: "OPEN" },
        // Zähl-Link verfällt mit dem Festschreiben.
        data: { status: "CLOSED", closedAt: new Date(), closedBy: s.userName.slice(0, 120), countToken: null, countTokenExpiresAt: null },
      });
      if (res.count !== 1) throw new CloseConflict("Inventur ist schon festgeschrieben");
      // Liste seit der Prüfung oben geändert: Bestätigungen passen nicht mehr.
      const lines = await tx.stocktakeLine.findMany({
        where: { stocktakeId: id, accountId: s.accountId },
        select: { id: true, articleId: true, counted: true, broken: true, purchasePriceCents: true },
      });
      if (hashContent(lines) !== currentHash) {
        throw new CloseConflict("Die Liste wurde gerade geändert. Bitte die Zählung neu bestätigen.");
      }
      await tx.$executeRaw`
        UPDATE "Article" AS a
        SET "stock" = l."counted", "updatedAt" = (now() AT TIME ZONE 'UTC')
        FROM "StocktakeLine" AS l
        WHERE l."stocktakeId" = ${id}
          AND l."accountId" = ${s.accountId}
          AND l."counted" IS NOT NULL
          AND a."id" = l."articleId"
          AND a."accountId" = ${s.accountId}`;
      return lines.filter((l) => l.articleId != null && l.counted != null).length;
    });
  } catch (e) {
    if (e instanceof CloseConflict) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
  await logEvents(s.db, id, s.accountId, { name: s.userName, adminId: s.adminId, via: "app" }, [
    { type: "CLOSED", note: `${updated} Bestände übernommen` },
  ]);
  return NextResponse.json({ ok: true, updated });
}

class CloseConflict extends Error {}
