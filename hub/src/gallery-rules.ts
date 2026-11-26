/**
 * Reine Regeln fuer den Abruf der Gesichter-Galerie aus der Cloud (ohne I/O,
 * testbar):
 *  - galleryRequest(): welche Adresse der naechste Abruf nimmt (mit Version
 *    oder voller Abruf).
 *  - decodeEmbedding(): Merkmal aus Base64 (Float32 LE) oder Zahlen-Array.
 *  - parseGallery(): Antwort der Cloud lesen (unveraendert, ganzer Bestand
 *    oder unbrauchbar).
 *
 * Die Cloud kennt seit diesem Stand `?v=<version>` (Antwort bei gleichem
 * Bestand nur `{ unchanged: true, version }`) und `?enc=b64`. Eine aeltere
 * Cloud ueberliest beides und schickt wie bisher den ganzen Bestand als
 * Zahlen-Arrays ohne Version; dann fragt der Hub weiter ohne Version.
 */
import type { GalleryItem } from "./face-rules.js";

export const GALLERY_PATH = "/api/hub/person-embeddings";
/**
 * Spaetestens nach dieser Zeit holt der Hub den ganzen Bestand ohne Version.
 * Sollte die Version eine Aenderung einmal nicht erfassen, ist eine neu
 * gesperrte Person so spaetestens nach einer Stunde in der Galerie.
 */
export const GALLERY_FULL_EVERY_MS = 60 * 60_000;

export interface GalleryEntry extends GalleryItem {
  id: number;
}

/**
 * Adresse des naechsten Abrufs und die dabei geschickte Version. Immer mit
 * `enc=b64` (eine aeltere Cloud ueberliest es). Die Version nur, wenn eine
 * bekannt ist und der letzte volle Abruf weniger als GALLERY_FULL_EVERY_MS
 * zurueckliegt; sonst `sent` null und ganzer Bestand.
 */
export function galleryRequest(opts: { version: string | null; fullAt: number; now: number }): {
  path: string;
  sent: string | null;
} {
  const v = opts.version;
  // Auch bei zurueckgestellter Uhr (Alter negativ) lieber der ganze Bestand.
  const age = opts.now - opts.fullAt;
  if (!v || !(age >= 0 && age < GALLERY_FULL_EVERY_MS)) return { path: `${GALLERY_PATH}?enc=b64`, sent: null };
  return { path: `${GALLERY_PATH}?enc=b64&v=${encodeURIComponent(v)}`, sent: v };
}

/**
 * Merkmal aus der Antwort: Zahlen-Array (bisher) oder Base64 mit Float32
 * little endian (wie der Header X-Face-Embedding). Beide Formen ergeben
 * dieselben Werte; wie die Cloud werden nur ganze 4 Bytes gelesen. null =
 * unbrauchbar (leer, keine endliche Zahl, kein Text/Array).
 */
export function decodeEmbedding(value: unknown): number[] | null {
  let out: number[];
  if (Array.isArray(value)) {
    out = value as number[];
  } else if (typeof value === "string" && value.length > 0) {
    const buf = Buffer.from(value, "base64");
    out = [];
    for (let i = 0; i + 3 < buf.length; i += 4) out.push(buf.readFloatLE(i));
  } else {
    return null;
  }
  if (out.length === 0 || !out.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return out;
}

export type GalleryReply =
  /** Bestand wie beim letzten Abruf: Galerie bleibt, nur der Lade-Zeitpunkt wird gesetzt. */
  | { kind: "unchanged" }
  /** Ganzer Bestand; `version` null = Cloud ohne Versionen. `dropped` = Eintraege ohne brauchbares Merkmal. */
  | { kind: "full"; entries: GalleryEntry[]; version: string | null; dropped: number }
  /** Unbrauchbar: Die Galerie bleibt, und der naechste Abruf holt alles ohne Version. */
  | { kind: "invalid"; reason: string };

/**
 * Antwort lesen. `unchanged` gilt nur, wenn die Cloud genau die geschickte
 * Version bestaetigt. Ohne Liste `embeddings` ist der Bestand leer – wie
 * bisher.
 */
export function parseGallery(data: unknown, sentVersion: string | null): GalleryReply {
  const d = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const version = typeof d.version === "string" && d.version ? d.version : null;
  if (d.unchanged === true) {
    if (sentVersion && version === sentVersion) return { kind: "unchanged" };
    return { kind: "invalid", reason: "unveraendert ohne passende Version" };
  }
  const list = Array.isArray(d.embeddings) ? d.embeddings : [];
  const entries: GalleryEntry[] = [];
  let dropped = 0;
  for (const raw of list) {
    const e = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const embedding = e ? decodeEmbedding(e.embedding) : null;
    if (!e || !embedding) {
      dropped++;
      continue;
    }
    entries.push({
      id: Number(e.id),
      listedPersonId: Number(e.listedPersonId),
      name: typeof e.name === "string" ? e.name : String(e.name ?? ""),
      listType: typeof e.listType === "string" ? e.listType : String(e.listType ?? ""),
      embedding,
    });
  }
  return { kind: "full", entries, version, dropped };
}
