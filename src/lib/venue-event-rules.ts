/**
 * Regeln fuer Veranstaltungen in Veranstaltungsraeumen (z. B. Rooftop
 * Lounge), ohne Datenbank: Zeiten, Ueberschneidung samt Puffer,
 * Zusatzleistungs-Summen und was ein Partner wann noch selbst aendern darf.
 * Geteilt von Backoffice, Partner-Portal und Tests.
 */
import { z } from "zod";
import { berlinOffset } from "@/lib/anny-availability";

export type VenueExtraUnit = "FLAT" | "PER_PERSON" | "PER_PIECE";
export type VenueEventStatus = "RESERVED" | "CONFIRMED" | "CANCELED";
export type VenueDocumentKind = "ORDER_CONFIRMATION" | "DEPOSIT_INVOICE" | "FINAL_INVOICE" | "OTHER";

export const DOCUMENT_KINDS: VenueDocumentKind[] = ["ORDER_CONFIRMATION", "DEPOSIT_INVOICE", "FINAL_INVOICE", "OTHER"];

export const DOCUMENT_KIND_LABEL: Record<VenueDocumentKind, string> = {
  ORDER_CONFIRMATION: "Auftragsbestätigung",
  DEPOSIT_INVOICE: "Anzahlungsrechnung",
  FINAL_INVOICE: "Schlussrechnung",
  OTHER: "Sonstiges",
};

/** Kurzform fuer Badges in Listen. */
export const DOCUMENT_KIND_SHORT: Record<VenueDocumentKind, string> = {
  ORDER_CONFIRMATION: "AB",
  DEPOSIT_INVOICE: "Anzahlung",
  FINAL_INVOICE: "Schluss",
  OTHER: "Dok.",
};

export const STATUS_LABEL: Record<VenueEventStatus, string> = {
  RESERVED: "Eingetragen",
  CONFIRMED: "Bestätigt",
  CANCELED: "Abgesagt",
};

export const UNIT_LABEL: Record<VenueExtraUnit, string> = {
  FLAT: "pauschal",
  PER_PERSON: "je Person",
  PER_PIECE: "je Stück",
};

/** Hoechstgroesse eines hochgeladenen PDFs (Vercel nimmt bis 4,5 MB Body an). */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Laengste erlaubte Veranstaltung (Aufbau bis Abbau zaehlt der Puffer). */
export const MAX_EVENT_HOURS = 24;

function hmMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Beginn und Ende als Zeitpunkte. Ein Ende vor (oder gleich) dem Beginn
 * heisst: geht ueber Mitternacht, endet am Folgetag (Feier bis 02:00 Uhr).
 */
export function eventTimes(date: string, startTime: string, endTime: string): { startDate: Date; endDate: Date } | null {
  if (!YMD.test(date) || !HM.test(startTime) || !HM.test(endTime)) return null;
  const startDate = new Date(`${date}T${startTime}:00${berlinOffset(date)}`);
  if (Number.isNaN(startDate.getTime())) return null;
  let minutes = hmMinutes(endTime) - hmMinutes(startTime);
  if (minutes <= 0) minutes += 24 * 60;
  const endDate = new Date(startDate.getTime() + minutes * 60_000);
  return { startDate, endDate };
}

/** Ueberschneiden sich zwei Zeitraeume, wenn zwischen ihnen `bufferMinutes` frei bleiben muessen? */
export function overlapsWithBuffer(
  a: { startDate: Date; endDate: Date },
  b: { startDate: Date; endDate: Date },
  bufferMinutes: number,
): boolean {
  const buf = Math.max(0, bufferMinutes) * 60_000;
  return a.startDate.getTime() < b.endDate.getTime() + buf && b.startDate.getTime() < a.endDate.getTime() + buf;
}

/** Personenzahl, nach der abgerechnet wird: tatsaechliche, sonst geplante. */
export function billableGuests(e: { guestCount: number; actualGuests: number | null }): number {
  return e.actualGuests ?? e.guestCount;
}

export function extraLineCents(
  line: { unit: VenueExtraUnit; unitPriceCents: number; quantity: number },
  guests: number,
): number {
  if (line.unit === "PER_PERSON") return line.unitPriceCents * Math.max(0, guests);
  if (line.unit === "PER_PIECE") return line.unitPriceCents * Math.max(0, line.quantity);
  return line.unitPriceCents;
}

export function extrasTotalCents(
  lines: Array<{ unit: VenueExtraUnit; unitPriceCents: number; quantity: number }>,
  guests: number,
): number {
  return lines.reduce((sum, l) => sum + extraLineCents(l, guests), 0);
}

export interface PartnerEditState {
  /** Termin, Gaeste, Zusatzleistungen aendern und absagen. */
  canEdit: boolean;
  /** Tatsaechliche Personenzahl melden. */
  canReportGuests: boolean;
  /** Warum nicht (fuer den Partner sichtbar). */
  reason: string | null;
}

/**
 * Was der Partner an seinem Termin noch selbst darf. Bis `editLockHours`
 * vor Beginn alles; danach nur noch die tatsaechliche Personenzahl, und die
 * bis zur Schlussrechnung bzw. Abrechnung.
 */
export function partnerEditState(
  event: { status: VenueEventStatus; startDate: Date; billedAt: Date | null; hasFinalInvoice: boolean },
  editLockHours: number,
  now: Date = new Date(),
): PartnerEditState {
  if (event.status === "CANCELED") return { canEdit: false, canReportGuests: false, reason: "Abgesagt." };
  const closed = !!event.billedAt || event.hasFinalInvoice;
  if (closed) return { canEdit: false, canReportGuests: false, reason: "Abgerechnet. Änderungen bitte direkt mit uns klären." };
  const lockAt = event.startDate.getTime() - Math.max(0, editLockHours) * 3_600_000;
  const canEdit = now.getTime() < lockAt;
  return {
    canEdit,
    canReportGuests: true,
    reason: canEdit ? null : `Ab ${editLockHours} Std. vor Beginn ändern wir nur noch auf Zuruf. Die tatsächliche Personenzahl könnt ihr weiter melden.`,
  };
}

/** Euro-Betrag zur Anzeige. */
export function formatEuro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

/** "Sa, 14.11.2026" aus YYYY-MM-DD. */
export function formatEventDay(ymd: string, withYear = true): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${withYear ? y : ""}`;
}

/** "18:00–02:00 Uhr" (Folgetag wird nicht extra genannt, die Zeit erklaert sich). */
export function formatEventTime(startTime: string, endTime: string): string {
  return `${startTime}–${endTime} Uhr`;
}

// ─── Eingaben ────────────────────────────────────────────────────────────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const extraSelectionSchema = z.object({
  extraId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(10_000).default(1),
});

/** Termin anlegen/aendern (Partner und Backoffice). */
export const eventInputSchema = z.object({
  areaId: z.coerce.number().int().positive(),
  title: z.string().trim().min(1, "Bitte einen Titel angeben").max(120),
  hostName: optionalText(120),
  date: z.string().regex(YMD, "Ungültiges Datum"),
  startTime: z.string().regex(HM, "Ungültige Uhrzeit"),
  endTime: z.string().regex(HM, "Ungültige Uhrzeit"),
  guestCount: z.coerce.number().int().min(1, "Mindestens eine Person").max(10_000),
  note: optionalText(1000),
  extras: z.array(extraSelectionSchema).max(50).default([]),
  /** Name der Person, die eintraegt (Partner). */
  byName: optionalText(120),
});
export type EventInput = z.infer<typeof eventInputSchema>;

/** Nur die tatsaechliche Personenzahl melden. */
export const reportGuestsSchema = z.object({
  actualGuests: z.coerce.number().int().min(0).max(10_000),
  byName: optionalText(120),
});

/** Zusatzleistung im Katalog eines Raums. */
export const extraSchema = z.object({
  areaId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Bitte einen Namen angeben").max(120),
  description: optionalText(500),
  priceCents: z.coerce.number().int().min(0).max(100_000_000),
  unit: z.enum(["FLAT", "PER_PERSON", "PER_PIECE"]),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
});

/** Partner-Adresse grob pruefen (leer erlaubt). */
export const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v == null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Ungültige E-Mail-Adresse");

/**
 * Kurze Beschreibung, was sich zwischen alt und neu geaendert hat (fuer
 * Verlauf und Benachrichtigung). Leer, wenn nichts Relevantes.
 */
export function describeChanges(
  before: { title: string; date: string; startTime: string; endTime: string; guestCount: number; extrasKey: string },
  after: { title: string; date: string; startTime: string; endTime: string; guestCount: number; extrasKey: string },
): string[] {
  const out: string[] = [];
  if (before.title !== after.title) out.push(`Titel „${after.title}“`);
  if (before.date !== after.date || before.startTime !== after.startTime || before.endTime !== after.endTime) {
    out.push(`Zeit ${formatEventDay(after.date)} ${formatEventTime(after.startTime, after.endTime)}`);
  }
  if (before.guestCount !== after.guestCount) out.push(`Personen ${before.guestCount} → ${after.guestCount}`);
  if (before.extrasKey !== after.extrasKey) out.push("Zusatzleistungen geändert");
  return out;
}

/** Stabiler Vergleichsschluessel fuer gewaehlte Zusatzleistungen. */
export function extrasKey(lines: Array<{ extraId: number | null; quantity: number }>): string {
  return lines
    .map((l) => `${l.extraId ?? 0}x${l.quantity}`)
    .sort()
    .join(",");
}

/** Partner und sein Portal (Backoffice). */
export const partnerSchema = z.object({
  name: z.string().trim().min(1, "Bitte einen Namen angeben").max(120),
  contactName: optionalText(120),
  logoUrl: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v == null || /^https:\/\/[^\s"'<>]+$/.test(v), "Das Logo braucht eine https-Adresse"),
  contactEmail: optionalEmail,
  notifyEmail: optionalEmail,
  portalEnabled: z.boolean(),
  areaIds: z.array(z.coerce.number().int().positive()).max(50),
  editLockHours: z.coerce.number().int().min(0).max(24 * 60),
  horizonDays: z.coerce.number().int().min(1).max(1095),
});
