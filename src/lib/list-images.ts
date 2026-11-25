/**
 * Bilder in Listen: Fundsachen und Artikel tragen ihr Foto als Data-URL in
 * der Datenbank. Listen laden diese Spalte nicht mehr mit, sondern liefern
 * je Eintrag eine Adresse auf eine Bild-Route; der Browser holt jedes Bild
 * einmal und nimmt es danach aus dem Cache (`v` = Änderungszeitpunkt).
 *
 * Ablauf in einer Liste:
 *  1. Liste ohne Bildspalte laden.
 *  2. `select: { id }` mit `where: { image: { not: null } }`: welche Einträge ein Bild haben.
 *  3. `inlineImageRows(...)` (lib/list-images-db): Bilder, die die Route
 *     nicht als Bytes ausliefert (Web-Adressen, ältere Sonderformate). Die
 *     bleiben wie bisher direkt in der Liste; sie sind klein bzw. selten.
 *  4. `listImageSrcs(...)` ergibt je ID die Bildquelle für `<img src>`.
 */

/**
 * Präfixe der Data-URLs, die die Bild-Routen als Bytes ausliefern
 * (passend zu `decodeImageDataUrl` in lib/photo-url).
 */
export const ROUTE_IMAGE_PREFIXES = [
  "data:image/jpeg;base64,",
  "data:image/png;base64,",
  "data:image/webp;base64,",
  "data:image/gif;base64,",
] as const;

/**
 * Bildquelle je Eintrag: Adresse der Bild-Route, bei Sonderfällen der
 * gespeicherte Wert selbst. Einträge ohne Bild fehlen in der Map.
 */
export function listImageSrcs(
  withImage: readonly { id: number }[],
  inline: readonly { id: number; image: string | null }[],
  routeUrl: (id: number) => string,
): Map<number, string> {
  const inlineById = new Map<number, string>();
  for (const row of inline) if (row.image) inlineById.set(row.id, row.image);
  const out = new Map<number, string>();
  for (const { id } of withImage) out.set(id, inlineById.get(id) ?? routeUrl(id));
  return out;
}

/** Opt-in der JSON-Listen: `?fotos=url` liefert `hasImage`/`imageUrl` statt `image`. */
export function wantsImageUrls(params: URLSearchParams): boolean {
  return params.get("fotos") === "url";
}

/**
 * Wert aus einem Formular, der auf eine eigene Bild-Route zeigt (`/api/…`):
 * Das Formular hat das angezeigte Bild unverändert zurückgeschickt. Solche
 * Werte werden ignoriert, das gespeicherte Bild bleibt.
 */
export function isImageRouteRef(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("/api/");
}

/** Entfernt `image` aus einem Formular-Body, wenn es nur die Adresse der Bild-Route ist. */
export function dropImageRouteRef(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const rec = body as Record<string, unknown>;
  if (!isImageRouteRef(rec.image)) return body;
  const rest = { ...rec };
  delete rest.image;
  return rest;
}

/**
 * Neue Uploads: nur JPG, PNG oder WebP als Base64-Data-URL, Präfix genau so
 * klein geschrieben, wie Browser es erzeugen (und wie die Listen es als
 * Route-Bild erkennen, siehe ROUTE_IMAGE_PREFIXES).
 */
export function isUploadImageDataUrl(value: string): boolean {
  return /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/.test(value);
}

/** Bild-Route einer Fundsache im Dashboard bzw. für die Fundsachen-API. */
export function lostItemImageUrl(id: number, updatedAt: Date): string {
  return `/api/lost-items/${id}/image?v=${updatedAt.getTime()}`;
}

/** Bild-Route einer Fundsache für den Check-in-Monitor (Link-Token). */
export function checkinLostItemImageUrl(token: string, id: number, updatedAt: Date): string {
  return `/api/checkin/public/${encodeURIComponent(token)}/lost-items/${id}/image?v=${updatedAt.getTime()}`;
}

/** Bild-Route eines Artikels im Dashboard. */
export function articleImageUrl(id: number, updatedAt: Date): string {
  return `/api/warenwirtschaft/articles/${id}/image?v=${updatedAt.getTime()}`;
}

/** Bild-Route einer Zählzeile über den Zähl-Link. */
export function countLineImageUrl(token: string, lineId: number, updatedAt: Date): string {
  return `/api/zaehlen/${encodeURIComponent(token)}/image?id=${lineId}&v=${updatedAt.getTime()}`;
}

/** Header der Bild-Routen: privat im Browser, die URL trägt die Version. */
export const IMAGE_ROUTE_HEADERS = {
  "Cache-Control": "private, max-age=31536000, immutable",
  "X-Content-Type-Options": "nosniff",
} as const;
