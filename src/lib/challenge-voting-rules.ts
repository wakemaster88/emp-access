/**
 * Regeln für Foto-Challenges und Abstimmungen ohne Datenbank (testbar, auch
 * im Browser nutzbar).
 */

/** Größte Data-URL eines Challenge-Fotos (der Browser verkleinert vorher auf 1600 px). */
export const CHALLENGE_PHOTO_MAX_CHARS = 2_000_000;
/** Längste Kante, auf die die App ein Foto vor dem Hochladen verkleinert. */
export const CHALLENGE_PHOTO_PX = 1600;
/** Größere Bilder nimmt der Server beim Neu-Kodieren nicht an (40 Megapixel). */
export const CHALLENGE_PHOTO_MAX_INPUT_PIXELS = 40_000_000;
/** Längste Kante des Vorschaubilds im Raster (2 Spalten, Retina). */
export const CHALLENGE_THUMB_PX = 480;
/** So viele Tage nach dem Endtag zeigt die App eine Challenge noch (lib/rider-challenges). */
export const CHALLENGE_KEEP_ENDED_DAYS = 30;

/**
 * Zeigt die App die Fotos dieser Challenge gerade allen Kunden des Kontos?
 * Ja, solange die Challenge eingeschaltet ist und ihr Endtag höchstens
 * CHALLENGE_KEEP_ENDED_DAYS zurückliegt: dieselbe Auswahl wie in der App
 * (laufend, kommend und kürzlich beendet mit Ergebnis). Tage als "YYYY-MM-DD".
 */
export function challengePhotosShown(challenge: { active: boolean; endYmd: string }, todayYmd: string): boolean {
  if (!challenge.active) return false;
  const [y, m, d] = todayYmd.split("-").map(Number);
  const oldestEnd = new Date(Date.UTC(y, m - 1, d - CHALLENGE_KEEP_ENDED_DAYS)).toISOString().slice(0, 10);
  return challenge.endYmd >= oldestEnd;
}

export interface DecodedPhoto {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: "image/jpeg" | "image/png";
  ext: "jpg" | "png";
}

/**
 * Data-URL in Bytes umwandeln. Nimmt nur JPEG und PNG, geprüft an den ersten
 * Bytes der Datei (nicht nur an der Angabe in der URL).
 */
export function decodePhotoDataUrl(dataUrl: string): DecodedPhoto | null {
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.length < 100) return null;
  const bytes = new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (jpeg) return { bytes, contentType: "image/jpeg", ext: "jpg" };
  if (png) return { bytes, contentType: "image/png", ext: "png" };
  return null;
}

/** Inhaltstyp aus den ersten Bytes (für Fotos, die als Bytes in der Datenbank liegen). */
export function photoContentType(bytes: Uint8Array): string {
  return bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : "image/jpeg";
}

/**
 * Feste, aber je Person andere Reihenfolge der Fotos, solange abgestimmt
 * wird: niemand ist immer oben, und die Reihenfolge springt nicht bei jedem
 * Neuladen.
 */
export function seededOrder<T extends { id: number }>(items: T[], seed: number): T[] {
  const key = (id: number) => {
    let h = (Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed + 1, 0xc2b2ae35)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    return (h ^ (h >>> 13)) >>> 0;
  };
  return [...items].sort((a, b) => key(a.id) - key(b.id) || a.id - b.id);
}

/**
 * Anteile einer Abstimmung in ganzen Prozent, die zusammen 100 ergeben
 * (größter Rest bekommt den Rest). Ohne Stimmen alles 0.
 */
export function pollPercents(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return counts.map(() => 0);
  const raw = counts.map((c) => (c / total) * 100);
  const out = raw.map(Math.floor);
  let rest = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    out[i] += 1;
    rest -= 1;
  }
  return out;
}

/** „1 Stimme“ / „3 Stimmen“. */
export function votesText(n: number): string {
  return n === 1 ? "1 Stimme" : `${n} Stimmen`;
}
