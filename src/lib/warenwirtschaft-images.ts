import { prisma } from "@/lib/prisma";
import { AUTO_MATCH_MIN, OFF_IMAGE_SOURCE, candidatesFromOff, offSearchTerms, type ImageCandidate } from "@/lib/warenwirtschaft";

/**
 * Sucht Produktfotos bei Open Food Facts (offene Datenbank, Fotos unter
 * CC BY-SA 3.0). Liefert höchstens acht Kandidaten, beste zuerst; bei
 * Netz- oder Limitfehlern `null` (dann später erneut versuchen).
 */
export async function searchProductImages(articleName: string): Promise<ImageCandidate[] | null> {
  const terms = offSearchTerms(articleName);
  if (!terms) return [];
  const url = new URL("https://world.openfoodfacts.org/cgi/search.pl");
  url.searchParams.set("search_terms", terms);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", "12");
  url.searchParams.set("fields", "code,product_name,product_name_de,brands,image_front_url,image_front_small_url,image_url");
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "emp-access-warenwirtschaft/1.0 (https://github.com/wakemaster88/emp-access)" },
      signal: AbortSignal.timeout(7000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { products?: unknown };
    const products = Array.isArray(data.products) ? data.products : [];
    return candidatesFromOff(articleName, products).slice(0, 8);
  } catch {
    return null;
  }
}

/** Open Food Facts erlaubt rund zehn Suchanfragen pro Minute; der Cron läuft alle fünf Minuten. */
const PER_TICK = 6;

/**
 * Cron (tick-5min): sucht für Artikel ohne Bild nacheinander ein Foto. Ein
 * Bild wird nur übernommen, wenn alle wesentlichen Wörter des Namens passen;
 * sonst bleibt das Kategorie-Symbol. Jeder Artikel wird einmal gefragt
 * (`imageSearchedAt`), außer die Suche schlägt fehl.
 */
export async function runArticleImageTick() {
  const batch = await prisma.article.findMany({
    where: { image: null, imageSearchedAt: null, active: true },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
    take: PER_TICK,
  });
  let found = 0;
  let failed = 0;
  for (const a of batch) {
    const candidates = await searchProductImages(a.name);
    if (candidates === null) {
      failed++;
      break; // Limit oder Netzfehler: Rest im nächsten Lauf.
    }
    const best = candidates[0];
    const hit = best && best.score >= AUTO_MATCH_MIN ? best : null;
    if (hit) found++;
    await prisma.article.update({
      where: { id: a.id },
      data: {
        imageSearchedAt: new Date(),
        ...(hit && { image: hit.imageUrl, imageSource: `${OFF_IMAGE_SOURCE} · ${hit.productUrl}` }),
      },
    });
  }
  return { checked: batch.length - failed, found, failed };
}
