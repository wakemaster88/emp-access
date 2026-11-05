/**
 * Wiederkehrende Fahrzeuge: unbekanntes Kennzeichen, das an mehreren
 * Besuchen da war → einmal fragen, ob es auf die genehmigte Liste kommt.
 * Ein Besuch zaehlt neu, wenn seit der letzten Sichtung VISIT_GAP vergangen
 * ist (ein Auto, das eine Stunde am Tor steht, ist ein Besuch). Reine Logik.
 */

export interface PlateRecord {
  plate: string;
  visits: number;
  firstAt: number;
  lastAt: number;
  /** null = noch nicht gefragt; "asked" | "approved" | "declined". */
  state: null | "asked" | "approved" | "declined";
  askedAt?: number;
  camera?: string;
}

export type PlateBook = Record<string, PlateRecord>;

export const VISIT_GAP_MS = 2 * 60 * 60_000;
/** Unbeantwortete Frage nach einer Woche erneut stellen. */
export const REASK_MS = 7 * 24 * 60 * 60_000;

export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, "");
}

/** Sichtung verbuchen. true = jetzt fragen. */
export function notePlate(
  book: PlateBook,
  plate: string,
  now: number,
  opts: { minVisits: number; camera?: string }
): boolean {
  const key = normalizePlate(plate);
  if (key.length < 4) return false;
  const rec = book[key] ?? { plate, visits: 0, firstAt: now, lastAt: 0, state: null };
  if (rec.visits === 0 || now - rec.lastAt >= VISIT_GAP_MS) rec.visits++;
  rec.lastAt = now;
  rec.plate = plate;
  if (opts.camera) rec.camera = opts.camera;
  book[key] = rec;
  if (rec.visits < opts.minVisits) return false;
  if (rec.state === "approved" || rec.state === "declined") return false;
  if (rec.state === "asked" && rec.askedAt !== undefined && now - rec.askedAt < REASK_MS) return false;
  rec.state = "asked";
  rec.askedAt = now;
  return true;
}

export function markPlate(book: PlateBook, plate: string, state: "approved" | "declined"): void {
  const key = normalizePlate(plate);
  const rec = book[key];
  if (rec) rec.state = state;
  else book[key] = { plate, visits: 0, firstAt: Date.now(), lastAt: Date.now(), state };
}
