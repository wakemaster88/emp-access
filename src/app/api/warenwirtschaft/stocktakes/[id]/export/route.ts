import { NextRequest } from "next/server";
import { notFound, wawiSession } from "@/lib/warenwirtschaft-server";
import { stocktakeTotals, toCsv, valueCents } from "@/lib/warenwirtschaft";

type Ctx = { params: Promise<{ id: string }> };

const euro = (cents: number | null) => (cents == null ? null : cents / 100);

/** GET /api/warenwirtschaft/stocktakes/[id]/export – Inventurliste als CSV (Excel). */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const st = await s.db.stocktake.findFirst({
    where: { id, accountId: s.accountId },
    include: { lines: { orderBy: [{ category: "asc" }, { name: "asc" }] } },
  });
  if (!st) return notFound("Inventur");

  const rows: (string | number | null)[][] = [
    [st.title],
    [`Datum: ${st.date.toLocaleDateString("de-DE", { timeZone: "UTC" })}`, st.status === "CLOSED" ? "festgeschrieben" : "offen"],
    [],
    ["Kategorie", "Bezeichnung", "Artikel-Nr.", "Einheit", "EK netto", "Soll", "Ist Bestand", "Lagerwert", "Bruch", "Bruchwert"],
  ];
  for (const l of st.lines) {
    rows.push([
      l.category,
      l.name,
      l.sku,
      l.unit,
      euro(l.purchasePriceCents),
      l.expected,
      l.counted,
      l.counted == null ? null : euro(valueCents(l.counted, l.purchasePriceCents)),
      l.broken,
      l.broken == null ? null : euro(valueCents(l.broken, l.purchasePriceCents)),
    ]);
  }
  const t = stocktakeTotals(st.lines);
  rows.push([], ["Gesamt", null, null, null, null, null, null, euro(t.valueCents), null, euro(t.brokenCents)]);

  const fileName = `${st.title.replace(/[^\wäöüÄÖÜß.-]+/g, "_")}.csv`;
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
