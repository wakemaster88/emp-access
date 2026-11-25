import { NextResponse } from "next/server";
import { Prisma, type PrismaClient } from "@prisma/client";
import { decodeImageDataUrl, isPhotoRedirectTarget, type DecodedDataUrl, type PhotoIds } from "@/lib/photo-url";

/** Bildtypen, die die Foto-Routen ausliefern. */
export const PHOTO_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Die Check-in-Foto-Route liefert ueber `decodeImageDataUrl` auch GIF aus. */
export const CHECKIN_PHOTO_TYPES: ReadonlySet<string> = new Set([...PHOTO_TYPES, "image/gif"]);

/** Bis zu dieser Laenge (Bytes) liest die ID-Abfrage den ganzen Wert, sonst nur den Anfang. */
const PHOTO_FULL_MAX = 2048;
/** So viele Zeichen vom Anfang reichen fuer Typ bzw. Link-Erkennung. */
const PHOTO_HEAD_CHARS = 256;

/**
 * Was eine Foto-Route aus dem gespeicherten `profileImage` macht: das Bild,
 * eine Weiterleitung auf einen bekannten Foto-Host oder nichts (404).
 */
export function storedPhotoTarget(
  stored: string | null | undefined,
  types: ReadonlySet<string> = PHOTO_TYPES,
): { redirect: string } | { image: DecodedDataUrl } | null {
  const value = stored?.trim() ?? "";
  if (/^https:\/\//i.test(value)) return isPhotoRedirectTarget(value) ? { redirect: value } : null;
  const image = value ? decodeImageDataUrl(value) : null;
  return image && types.has(image.contentType) ? { image } : null;
}

/**
 * True, wenn die Foto-Route das gespeicherte Foto ausliefert. `full` ist der
 * ganze Wert, wenn er kurz ist; dann gilt genau `storedPhotoTarget`. Bei
 * langen Werten (Data-URLs) entscheidet der Anfang `head`: Data-URL mit
 * einem der Typen. Lange Links gelten als nicht auslieferbar.
 */
export function storedPhotoServable(
  head: string | null,
  full: string | null,
  types: ReadonlySet<string> = PHOTO_TYPES,
): boolean {
  if (full !== null) return storedPhotoTarget(full, types) !== null;
  const match = /^data:([a-z0-9.+/-]+);base64,/i.exec((head ?? "").trimStart());
  return !!match && types.has(match[1].toLowerCase());
}

/**
 * Ticket-IDs mit gespeichertem Foto, ohne das ganze Foto zu lesen. Gleiche
 * Bedeutung wie `!!ticket.profileImage` (leerer Text zaehlt nicht).
 * `servable`: die Teilmenge, deren Foto die Foto-Route ausliefert (siehe
 * `storedPhotoServable`; `types` wie die jeweilige Route). Nur dafuer gibt
 * es eine `photoUrl`; die uebrigen zeigen in den Listen die Initialen bzw.
 * das Symbol statt eines Bildes.
 *
 * Eine Abfrage je Block: liest nur den Anfang des Wertes (Postgres entpackt
 * dafuer nur ein Stueck) und den ganzen Wert nur, wenn er kurz ist. `ids`
 * kommen aus bereits mandantengebundenen Abfragen des Aufrufers.
 */
export async function ticketIdsWithPhoto(
  db: PrismaClient,
  ids: Iterable<number>,
  types: ReadonlySet<string> = PHOTO_TYPES,
): Promise<PhotoIds> {
  const unique = [...new Set(ids)];
  const stored = new Set<number>();
  const servable = new Set<number>();
  // In Bloecken, damit lange Listen unter der Parametergrenze bleiben.
  for (let i = 0; i < unique.length; i += 10_000) {
    const chunk = unique.slice(i, i + 10_000);
    const rows = await db.$queryRaw<Array<{ id: number; head: string | null; full: string | null }>>`
      SELECT "id",
        left("profileImage", ${PHOTO_HEAD_CHARS}) AS "head",
        CASE WHEN octet_length("profileImage") < ${PHOTO_FULL_MAX} THEN "profileImage" END AS "full"
      FROM "Ticket"
      WHERE "id" IN (${Prisma.join(chunk)})
        AND "profileImage" IS NOT NULL AND "profileImage" <> ''
    `;
    for (const r of rows) {
      stored.add(r.id);
      if (storedPhotoServable(r.head, r.full, types)) servable.add(r.id);
    }
  }
  return Object.assign(stored, { servable });
}

/**
 * Antwort einer Foto-Route aus dem gespeicherten `profileImage`: die Bytes
 * mit passendem Typ, eine Weiterleitung bei bekannten Foto-Hosts, sonst 404.
 * `versioned`: die URL traegt `v=<updatedAt>`, der Browser darf das Bild
 * dauerhaft behalten.
 */
export function ticketPhotoResponse(stored: string | null | undefined, versioned: boolean): NextResponse {
  const target = storedPhotoTarget(stored);
  if (!target) return NextResponse.json({ error: "Kein Foto" }, { status: 404 });
  if ("redirect" in target) return NextResponse.redirect(target.redirect, 302);
  const { image } = target;
  return new NextResponse(Buffer.from(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.bytes.length),
      // `private`: Personenfotos gehoeren nicht in einen geteilten CDN-Cache.
      "Cache-Control": versioned ? "private, max-age=31536000, immutable" : "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
