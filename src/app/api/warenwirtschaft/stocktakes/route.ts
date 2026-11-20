import { NextRequest, NextResponse } from "next/server";
import { badRequest, countTokenExpiry, dateOnly, newCountToken, stocktakeCreateSchema, wawiSession } from "@/lib/warenwirtschaft-server";
import { logEvents } from "@/lib/stocktake-audit";

/**
 * POST /api/warenwirtschaft/stocktakes – Inventur anlegen.
 * Legt für jeden aktiven Artikel (laufende Inventur: nur die gewählten
 * Kategorien) eine Zeile mit dem aktuellen Bestand als Soll an und erzeugt
 * gleich den Zähl-Link fürs Handy (`/zaehlen/<token>`).
 */
export async function POST(request: NextRequest) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const parsed = stocktakeCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.flatten());
  const { kind, date, note } = parsed.data;
  const categories = kind === "ROLLING" ? parsed.data.categories?.filter(Boolean) ?? [] : [];

  if (kind === "CUTOFF") {
    const exists = await s.db.stocktake.findFirst({
      where: { accountId: s.accountId, kind: "CUTOFF", date: dateOnly(date) },
      select: { id: true },
    });
    if (exists) return NextResponse.json({ error: "Für diesen Stichtag gibt es schon eine Inventur", id: exists.id }, { status: 409 });
  }

  const articles = await s.db.article.findMany({
    where: { accountId: s.accountId, active: true, ...(categories.length > 0 && { category: { in: categories } }) },
    select: { id: true, name: true, sku: true, category: true, unit: true, purchasePriceCents: true, stock: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  if (articles.length === 0) return NextResponse.json({ error: "Keine aktiven Artikel für diese Auswahl" }, { status: 400 });

  const d = dateOnly(date);
  const title =
    parsed.data.title?.trim() ||
    (kind === "CUTOFF"
      ? `Stichtagsinventur ${d.toLocaleDateString("de-DE", { timeZone: "UTC" })}`
      : `Zählung ${d.toLocaleDateString("de-DE", { timeZone: "UTC" })}${categories.length ? ` · ${categories.join(", ")}` : ""}`);

  const stocktake = await s.db.stocktake.create({
    data: {
      accountId: s.accountId,
      kind,
      title: title.slice(0, 160),
      date: d,
      note,
      countToken: newCountToken(),
      countTokenExpiresAt: countTokenExpiry(),
      lines: {
        create: articles.map((a) => ({
          accountId: s.accountId,
          articleId: a.id,
          name: a.name,
          sku: a.sku,
          category: a.category,
          unit: a.unit,
          purchasePriceCents: a.purchasePriceCents,
          expected: a.stock,
        })),
      },
    },
    select: { id: true },
  });
  await logEvents(s.db, stocktake.id, s.accountId, { name: s.userName, adminId: s.adminId, via: "app" }, [
    { type: "CREATED", note: `${articles.length} Artikel` },
  ]);
  return NextResponse.json(stocktake, { status: 201 });
}
