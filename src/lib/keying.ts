import { randomBytes } from "crypto";

/**
 * Schliessanlage: reine Rechenlogik ohne DB-Zugriff, damit sie testbar bleibt.
 *
 * Hierarchie: Raum -> Tuer -> Schloss. Schluessel haengen n:m an Schloessern;
 * ein Generalschluessel ist ein Schluessel mit vielen Zuordnungen. Ausgabe und
 * Ruecknahme laufen ueber ein Protokoll (Kopf + eine Position je Schluessel).
 */

export type KeyLevel = "SINGLE" | "GROUP" | "MAIN" | "GRAND";
export type KeyStatus = "AVAILABLE" | "ISSUED" | "LOST" | "DESTROYED";
export type HandoverItemStatus = "ISSUED" | "RETURNED" | "LOST";
export type HandoverStatus = "DRAFT" | "ISSUED" | "PARTIALLY_RETURNED" | "RETURNED" | "LOST";

export const KEY_LEVEL_LABELS: Record<KeyLevel, string> = {
  SINGLE: "Einzelschlüssel",
  GROUP: "Gruppenschlüssel",
  MAIN: "Hauptschlüssel",
  GRAND: "Generalschlüssel",
};

export const KEY_STATUS_LABELS: Record<KeyStatus, string> = {
  AVAILABLE: "Im Bestand",
  ISSUED: "Ausgegeben",
  LOST: "Verloren",
  DESTROYED: "Vernichtet",
};

export const LOCK_TYPE_LABELS: Record<string, string> = {
  CYLINDER: "Zylinder",
  PADLOCK: "Vorhängeschloss",
  ELECTRONIC: "Elektronisch",
  OTHER: "Sonstiges",
};

export const HANDOVER_STATUS_LABELS: Record<HandoverStatus, string> = {
  DRAFT: "Entwurf",
  ISSUED: "Ausgegeben",
  PARTIALLY_RETURNED: "Teilweise zurück",
  RETURNED: "Zurückgegeben",
  LOST: "Verlust",
};

/** Gueltigkeit eines Signatur-Links, wenn nichts anderes gesetzt ist. */
export const SIGNATURE_DEFAULT_DAYS = 14;

/**
 * Kopf-Status aus den Positionen ableiten. Ein Protokoll ist erst dann
 * abgeschlossen, wenn kein Schluessel mehr offen ist; sind ausschliesslich
 * Verluste gemeldet, gilt der ganze Vorgang als Verlust.
 */
export function deriveHandoverStatus(items: { itemStatus: string }[]): HandoverStatus {
  if (items.length === 0) return "DRAFT";

  const open = items.filter((i) => i.itemStatus === "ISSUED").length;
  const lost = items.filter((i) => i.itemStatus === "LOST").length;

  if (open === items.length) return "ISSUED";
  if (open > 0) return "PARTIALLY_RETURNED";
  return lost === items.length ? "LOST" : "RETURNED";
}

/**
 * Schluessel, die nicht ausgegeben werden duerfen, weil sie bereits jemand
 * anderes hat oder sie aus dem Bestand raus sind.
 */
export function findUnavailableKeys<T extends { id: number; keyNumber: string; status: string }>(
  keys: T[],
): T[] {
  return keys.filter((k) => k.status !== "AVAILABLE");
}

/**
 * Nummernserie fuer Bulk-Anlage: prefix + separator + laufende Nummer.
 * `padding` fuellt links mit Nullen auf ("Z12-001").
 */
export function buildKeyNumberSeries(opts: {
  prefix: string;
  count: number;
  startIndex?: number;
  separator?: string;
  padding?: number;
}): string[] {
  const { prefix, count } = opts;
  const start = opts.startIndex ?? 1;
  const separator = opts.separator ?? "-";
  const padding = opts.padding ?? 0;

  return Array.from({ length: count }, (_, i) => {
    const n = String(start + i).padStart(padding, "0");
    return `${prefix}${separator}${n}`;
  });
}

/** Zugriffsgeheimnis der oeffentlichen Signaturseite. */
export function createSignatureToken(): string {
  return randomBytes(24).toString("base64url");
}

export type SignatureState = "OPEN" | "SIGNED" | "EXPIRED";

/**
 * Zustand eines Signaturvorgangs. Signiert schlaegt Ablauf: eine bereits
 * unterschriebene Erklaerung bleibt gueltig, auch wenn der Link ablaeuft.
 */
export function signatureState(
  sig: { signedAt: Date | null; expiresAt: Date },
  now: Date,
): SignatureState {
  if (sig.signedAt) return "SIGNED";
  return sig.expiresAt.getTime() < now.getTime() ? "EXPIRED" : "OPEN";
}

/** Kurze Tokens gar nicht erst gegen die DB laufen lassen. */
export function isPlausibleSignatureToken(token: string | undefined | null): boolean {
  return typeof token === "string" && token.length >= 16 && token.length <= 128;
}

export type HolderLike = {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
};

/** Anzeigename: "Vorname Nachname (Firma)", mit Firma als Fallback. */
export function holderDisplayName(holder: HolderLike): string {
  const person = [holder.firstName, holder.lastName]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(" ");
  const company = holder.company?.trim();

  if (person && company) return `${person} (${company})`;
  return person || company || "Unbekannt";
}

/** Offene Rueckgabe ueberfaellig? */
export function isOverdue(
  handover: { dueAt: Date | null; status: string },
  now: Date,
): boolean {
  if (!handover.dueAt) return false;
  if (handover.status === "RETURNED" || handover.status === "LOST") return false;
  return handover.dueAt.getTime() < now.getTime();
}

/**
 * Schluesselstatus nach einer Protokoll-Aenderung. Verlust bleibt am
 * Schluessel haengen, zurueckgegebene Stuecke gehen in den Bestand.
 */
export function keyStatusAfterReturn(itemStatus: HandoverItemStatus): KeyStatus {
  if (itemStatus === "LOST") return "LOST";
  if (itemStatus === "RETURNED") return "AVAILABLE";
  return "ISSUED";
}
