/**
 * Gesichter-Galerie fuer den Hub (GET /api/hub/person-embeddings): Version
 * des Bestands und Form der Merkmale, als reine Regeln (ohne Datenbank).
 */

/** Kennzahlen des ausgelieferten Bestands, aus einer kleinen Aggregat-Abfrage. */
export interface GalleryStats {
  /** Anzahl der Merkmale aktiver Personen. */
  count: number;
  /** Hoechste id dieser Merkmale (null = keine). */
  maxId: number | null;
  /** Juengstes createdAt dieser Merkmale. */
  maxCreatedAt: Date | null;
  /** Juengstes updatedAt der aktiven Personen des Kontos. */
  maxPersonUpdatedAt: Date | null;
}

/**
 * Version des Bestands. Sie aendert sich bei jeder Aenderung, die der Hub
 * sehen muss:
 *  - Merkmal dazu (anlegen, zuordnen, lernen, Profil optimieren): neue
 *    hoechste id, denn ids wachsen nur.
 *  - Merkmal weg (Profil optimieren, Person geloescht, Person deaktiviert):
 *    Anzahl kleiner, solange nicht zugleich eines dazukommt (dann neue id).
 *  - Person geaendert (Name, Liste, Sperren, aktiv, reaktiviert): updatedAt
 *    der Person ist danach das juengste der aktiven Personen.
 * Merkmale werden nie an Ort und Stelle geaendert. Ohne Personen und
 * Merkmale ist die Version trotzdem ein fester Text.
 */
export function galleryVersion(s: GalleryStats): string {
  const ms = (d: Date | null) => {
    const t = d ? d.getTime() : NaN;
    return Number.isFinite(t) ? t.toString(36) : "0";
  };
  const id = s.maxId != null && Number.isFinite(s.maxId) ? s.maxId : 0;
  return `g1-${s.count}-${id}-${ms(s.maxCreatedAt)}-${ms(s.maxPersonUpdatedAt)}`;
}

/**
 * Gleiche Version wie beim Hub: Antwort nur `{ unchanged: true, version }`.
 * Ohne `v` (aelterer Hub, erster Abruf, stuendlicher voller Abruf) immer
 * der ganze Bestand.
 */
export function galleryUnchanged(requested: string | null, version: string): boolean {
  return requested != null && requested !== "" && requested === version;
}

/** Merkmale als Base64 (Float32 LE) statt Zahlen-Array: nur auf Wunsch des Hubs (`enc=b64`). */
export function galleryWantsBase64(enc: string | null): boolean {
  return enc === "b64";
}

/** Merkmal als Base64, dieselben Bytes wie im Header X-Face-Embedding (Float32 LE). */
export function embeddingBytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}
