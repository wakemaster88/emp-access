import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ROUTE_IMAGE_PREFIXES } from "./list-images";

/**
 * Sonderfälle der Bild-Listen (siehe lib/list-images): Einträge, deren Bild
 * nicht über die Bild-Route geht und deshalb direkt in der Liste bleibt.
 *
 * Postgres prüft dafür nur den Anfang der Bildspalte (`substring`) und die
 * gespeicherte Länge (`octet_length`); so muss die Datenbank nicht bei jedem
 * Abgleich sämtliche Fotos vollständig lesen. Nur die wenigen Sonderfälle
 * werden danach mit Bild geladen.
 *
 * `ids` kommen aus der bereits mandantengebundenen Liste; `accountId`
 * schränkt zusätzlich ein (null nur für den Super-Admin ohne Konto).
 * Mit `maxDataUrlChars` gelten Data-URLs über dieser Länge ebenfalls als
 * Sonderfall, kommen aber mit `image: null` zurück (Zähl-Link: kein Bild).
 */
export async function inlineImageRows(
  model: "lostItem" | "article",
  ids: readonly number[],
  opts: { accountId?: number | null; maxDataUrlChars?: number } = {},
): Promise<{ id: number; image: string | null }[]> {
  if (ids.length === 0) return [];
  const table = model === "lostItem" ? Prisma.raw(`"LostItem"`) : Prisma.raw(`"Article"`);
  const patterns = ROUTE_IMAGE_PREFIXES.map((p) => `${p}%`);
  const accountCond = opts.accountId != null ? Prisma.sql`AND "accountId" = ${opts.accountId}` : Prisma.empty;
  const tooLong =
    opts.maxDataUrlChars != null
      ? Prisma.sql`substring(image from 1 for 5) = 'data:' AND octet_length(image) > ${opts.maxDataUrlChars}`
      : Prisma.sql`false`;
  const rows = await prisma.$queryRaw<Array<{ id: number; too_long: boolean }>>`
    SELECT id, (${tooLong}) AS too_long
    FROM ${table}
    WHERE id = ANY(${[...ids]}::int[])
      ${accountCond}
      AND image IS NOT NULL
      AND (substring(image from 1 for 32) NOT LIKE ALL(${patterns}::text[]) OR (${tooLong}))
  `;
  if (rows.length === 0) return [];

  const tooLongIds = rows.filter((r) => r.too_long).map((r) => r.id);
  const loadIds = rows.filter((r) => !r.too_long).map((r) => r.id);
  const where = { id: { in: loadIds }, ...(opts.accountId != null ? { accountId: opts.accountId } : {}) };
  const loaded =
    loadIds.length === 0
      ? []
      : model === "lostItem"
        ? await prisma.lostItem.findMany({ where, select: { id: true, image: true } })
        : await prisma.article.findMany({ where, select: { id: true, image: true } });
  return [...loaded, ...tooLongIds.map((id) => ({ id, image: null }))];
}
