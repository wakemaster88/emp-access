import { NextRequest, NextResponse } from "next/server";
import { dateOnly, wawiSession } from "@/lib/warenwirtschaft-server";
import { readXlsx } from "@/lib/xlsx-read";
import { articleKey, assetKey, parseWawiWorkbook } from "@/lib/warenwirtschaft-import";

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/warenwirtschaft/import – Excel-Datei (Feld `file`) einlesen.
 * Legt neue Artikel und Inventar-Einträge an; was es schon gibt (gleicher
 * Name, Kategorie bzw. Blatt, Einheit/Bereich, Nummer), bleibt unverändert.
 * Eine Inventurliste mit Datum im Kopf wird zusätzlich als festgeschriebene
 * Stichtagsinventur übernommen, sofern es für das Datum noch keine gibt.
 */
export async function POST(request: NextRequest) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Bitte eine Excel-Datei wählen" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Datei ist größer als 10 MB" }, { status: 400 });

  let parsed;
  try {
    parsed = parseWawiWorkbook(readXlsx(Buffer.from(await file.arrayBuffer())));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Datei konnte nicht gelesen werden" }, { status: 400 });
  }
  if (parsed.articles.length === 0 && parsed.assets.length === 0) {
    return NextResponse.json({ error: "Keine Artikel- oder Inventarliste erkannt. Erwartet werden Spalten wie „Bezeichnung“ und „EK netto“ oder „Gerätenummer“." }, { status: 400 });
  }
  const { db, accountId } = s;
  const result = { articlesCreated: 0, articlesSkipped: 0, stocktake: null as null | { id: number; date: string }, assetsCreated: 0, assetsSkipped: 0, counts: 0 };

  // ─── Artikel ───
  if (parsed.articles.length > 0) {
    const existing = await db.article.findMany({ where: { accountId }, select: { id: true, name: true, category: true, unit: true, sku: true } });
    const idByKey = new Map(existing.map((a) => [articleKey(a), a.id]));
    const fresh = parsed.articles.filter((a) => !idByKey.has(articleKey(a)));
    result.articlesSkipped = parsed.articles.length - fresh.length;
    if (fresh.length > 0) {
      const created = await db.article.createManyAndReturn({
        data: fresh.map((a) => ({
          accountId,
          name: a.name.slice(0, 200),
          sku: a.sku?.slice(0, 60) ?? null,
          category: a.category.slice(0, 60),
          unit: a.unit?.slice(0, 40) ?? null,
          supplier: a.supplier?.slice(0, 120) ?? null,
          purchasePriceCents: a.purchasePriceCents,
          stock: a.stock,
        })),
        select: { id: true, name: true, category: true, unit: true, sku: true },
      });
      for (const a of created) idByKey.set(articleKey(a), a.id);
      result.articlesCreated = created.length;
    }

    if (parsed.cutoffDate) {
      const date = dateOnly(parsed.cutoffDate);
      const exists = await db.stocktake.findFirst({ where: { accountId, kind: "CUTOFF", date }, select: { id: true } });
      if (!exists) {
        const st = await db.stocktake.create({
          data: {
            accountId,
            kind: "CUTOFF",
            status: "CLOSED",
            title: `Inventur ${date.toLocaleDateString("de-DE", { timeZone: "UTC" })}`,
            date,
            note: `Übernommen aus ${file.name}`.slice(0, 1000),
            closedAt: new Date(),
            closedBy: `Excel-Import (${s.userName})`.slice(0, 120),
          },
          select: { id: true },
        });
        const seen = new Set<number>();
        await db.stocktakeLine.createMany({
          data: parsed.articles.flatMap((a) => {
            const articleId = idByKey.get(articleKey(a)) ?? null;
            // Doppelte Zeilen derselben Datei: Artikel nur einmal verknüpfen (Unique stocktakeId+articleId).
            const link = articleId != null && !seen.has(articleId) ? articleId : null;
            if (link != null) seen.add(link);
            return [{
              accountId,
              stocktakeId: st.id,
              articleId: link,
              name: a.name.slice(0, 200),
              sku: a.sku,
              category: a.category,
              unit: a.unit,
              purchasePriceCents: a.purchasePriceCents,
              expected: a.stock,
              counted: a.stock,
              broken: a.broken,
            }];
          }),
        });
        result.stocktake = { id: st.id, date: parsed.cutoffDate };
      }
    }
  }

  // ─── Inventar ───
  if (parsed.assets.length > 0) {
    const existing = await db.inventoryAsset.findMany({ where: { accountId }, select: { name: true, group: true, location: true, deviceNumber: true } });
    const known = new Set(existing.map(assetKey));
    const fresh = parsed.assets.filter((a) => !known.has(assetKey(a)));
    result.assetsSkipped = parsed.assets.length - fresh.length;
    if (fresh.length > 0) {
      const created = await db.inventoryAsset.createManyAndReturn({
        data: fresh.map((a) => ({
          accountId,
          name: a.name.slice(0, 200),
          group: a.group.slice(0, 60),
          location: a.location?.slice(0, 80) ?? null,
          deviceNumber: a.deviceNumber?.slice(0, 80) ?? null,
          lastInspection: a.lastInspection ? dateOnly(a.lastInspection) : null,
        })),
        select: { id: true, name: true, group: true, location: true, deviceNumber: true },
      });
      // Zuordnung über den Schlüssel statt über die Reihenfolge der Rückgabe.
      const idsByKey = new Map<string, number[]>();
      for (const c of created) idsByKey.set(assetKey(c), [...(idsByKey.get(assetKey(c)) ?? []), c.id]);
      const counts = fresh.flatMap((a) => {
        const assetId = idsByKey.get(assetKey(a))?.shift();
        return assetId == null ? [] : a.counts.map((x) => ({ accountId, assetId, year: x.year, quantity: x.quantity }));
      });
      if (counts.length > 0) await db.inventoryAssetCount.createMany({ data: counts, skipDuplicates: true });
      result.assetsCreated = created.length;
      result.counts = counts.length;
    }
  }

  return NextResponse.json(result);
}
