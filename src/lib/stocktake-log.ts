/**
 * Digitale Bestätigung und Protokoll einer Inventur (GoBD-orientiert):
 * reine Hilfsfunktionen ohne Datenbank, für Server, Oberfläche, PDF und Tests.
 *
 * Grundsätze:
 * - Jede Eingabe wird mit Person, Zeit, altem und neuem Wert protokolliert.
 * - Zähler und Schreiber bestätigen die Zählung jeweils mit dem eigenen
 *   Login (Passkey, ersatzweise Passwort). Das ersetzt die Unterschrift.
 * - Festschreiben geht nur mit beiden Bestätigungen; danach ist die Liste
 *   nur noch über eine begründete Korrektur änderbar, die im Protokoll steht.
 */

export type StocktakeRole = "COUNTER" | "WRITER";
export const STOCKTAKE_ROLES: StocktakeRole[] = ["COUNTER", "WRITER"];
export const ROLE_LABEL: Record<StocktakeRole, string> = { COUNTER: "Zähler", WRITER: "Schreiber" };

export type StocktakeEventType = "CREATED" | "COUNT" | "LINE_ADDED" | "SIGNED" | "SIGNATURE_VOID" | "CLOSED" | "CORRECTION";

export type LineField = "counted" | "broken" | "purchasePriceCents";
export const LINE_FIELDS: LineField[] = ["counted", "broken", "purchasePriceCents"];
export const FIELD_LABEL: Record<LineField, string> = { counted: "Ist", broken: "Bruch", purchasePriceCents: "EK netto" };

export const METHOD_LABEL: Record<string, string> = { passkey: "Passkey", password: "Passwort" };
export const VIA_LABEL: Record<string, string> = { app: "App", link: "Zähl-Link", system: "System" };

/** Mindestlänge der Begründung einer Korrektur nach dem Festschreiben. */
export const CORRECTION_REASON_MIN = 5;

export interface ContentLine {
  id: number;
  counted: number | null;
  broken: number | null;
  purchasePriceCents: number | null;
}

/**
 * Eindeutige Textform der Zählliste (Zeilen nach id sortiert). Der Server
 * bildet daraus die SHA-256-Prüfsumme, die bei jeder Bestätigung gespeichert
 * wird: Ändert sich danach etwas, passt sie nicht mehr.
 */
export function canonicalContent(lines: ContentLine[]): string {
  return [...lines]
    .sort((a, b) => a.id - b.id)
    .map((l) => `${l.id}:${l.counted ?? ""}:${l.broken ?? ""}:${l.purchasePriceCents ?? ""}`)
    .join("|");
}

/** Kurzform der Prüfsumme für Anzeige und PDF („3f9a 12c0 8b7e 44d1“). */
export function shortHash(hash: string): string {
  return (hash.slice(0, 16).match(/.{1,4}/g) ?? []).join(" ");
}

export interface FieldChange {
  field: LineField;
  oldValue: number | null;
  newValue: number | null;
}

/** Welche Felder einer Zeile ändert ein Patch wirklich? (Gleiche Werte → nichts.) */
export function lineChanges(
  before: Partial<Record<LineField, number | null>>,
  patch: Partial<Record<LineField, number | null | undefined>>,
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of LINE_FIELDS) {
    const next = patch[field];
    if (next === undefined) continue;
    const prev = before[field] ?? null;
    if (prev === next) continue;
    out.push({ field, oldValue: prev, newValue: next });
  }
  return out;
}

function qty(q: number | null | undefined): string {
  if (q == null || !Number.isFinite(q)) return "leer";
  return q.toLocaleString("de-DE", { maximumFractionDigits: 3 });
}

function euro(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "leer";
  return `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, "")} €`;
}

/** Wert eines Feldes für Protokoll und PDF. */
export function formatFieldValue(field: string | null | undefined, value: number | null | undefined): string {
  return field === "purchasePriceCents" ? euro(value) : qty(value);
}

export interface StocktakeEventLike {
  type: string;
  lineName: string | null;
  field: string | null;
  oldValue: number | null;
  newValue: number | null;
  actor: string;
  via: string;
  note: string | null;
}

/** Ein Protokolleintrag als deutscher Satz (ohne Person und Zeit). */
export function describeEvent(e: StocktakeEventLike): string {
  const field = e.field && e.field in FIELD_LABEL ? FIELD_LABEL[e.field as LineField] : e.field ?? "";
  const change = `${field}: ${formatFieldValue(e.field, e.oldValue)} → ${formatFieldValue(e.field, e.newValue)}`;
  switch (e.type) {
    case "CREATED":
      return e.note ? `Inventur angelegt (${e.note})` : "Inventur angelegt";
    case "COUNT":
      return `${e.lineName ?? "Artikel"} · ${change}`;
    case "LINE_ADDED":
      return `${e.lineName ?? "Artikel"} ergänzt${e.newValue != null ? ` (Ist ${qty(e.newValue)})` : ""}`;
    case "SIGNED":
      return `Zählung bestätigt als ${e.note ?? "Beteiligter"}`;
    case "SIGNATURE_VOID":
      return e.note ?? "Bestätigung aufgehoben";
    case "CLOSED":
      return "Inventur festgeschrieben";
    case "CORRECTION":
      return `Korrektur ${e.lineName ?? "Artikel"} · ${change}${e.note ? ` · Grund: ${e.note}` : ""}`;
    default:
      return e.type;
  }
}

export interface SignatureLike {
  role: StocktakeRole;
  adminId: number | null;
  name: string;
  contentHash: string;
}

/** Stand der Bestätigungen: welche Rollen fehlen, darf festgeschrieben werden? */
export function signatureStatus(signatures: SignatureLike[], currentHash: string) {
  const valid = signatures.filter((s) => s.contentHash === currentHash);
  const missing = STOCKTAKE_ROLES.filter((r) => !valid.some((s) => s.role === r));
  return { valid, missing, complete: missing.length === 0 };
}

/**
 * Darf diese Person die Rolle bestätigen? Zähler und Schreiber müssen zwei
 * verschiedene Personen sein (Vier-Augen-Prinzip). Gibt die Fehlermeldung
 * zurück oder null.
 */
export function signBlockedReason(signatures: SignatureLike[], role: StocktakeRole, adminId: number): string | null {
  if (signatures.some((s) => s.role === role)) return `Die Zählung ist als ${ROLE_LABEL[role]} schon bestätigt.`;
  const other = signatures.find((s) => s.role !== role);
  if (other && other.adminId === adminId) {
    return `Du hast schon als ${ROLE_LABEL[other.role]} bestätigt. Zähler und Schreiber müssen zwei verschiedene Personen sein.`;
  }
  return null;
}

/**
 * Vier-Augen-Prinzip beim Festschreiben: Die gültigen Bestätigungen von
 * Zähler und Schreiber müssen von zwei verschiedenen persönlichen Logins
 * stammen. Gibt die Fehlermeldung zurück oder null.
 */
export function signersBlockedReason(valid: SignatureLike[]): string | null {
  const ids = STOCKTAKE_ROLES.map((r) => valid.find((s) => s.role === r)?.adminId ?? null);
  if (ids.some((id) => id == null)) {
    return "Zum Festschreiben müssen Zähler und Schreiber mit zwei verschiedenen persönlichen Logins bestätigen.";
  }
  if (ids[0] === ids[1]) {
    return "Zähler und Schreiber sind dieselbe Person. Zum Festschreiben müssen zwei verschiedene Personen bestätigen.";
  }
  return null;
}
