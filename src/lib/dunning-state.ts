/**
 * Mahnstand eines Abos (`extras.paymentPause.dunning`) und die Stufenlogik des
 * Mahnlaufs, ohne Server-Abhängigkeiten (wird auch in der Oberfläche genutzt).
 * Ablauf und Versand: lib/dunning.
 */
import { addCalendarDays, berlinYmd } from "./berlin-day";
import type { PaymentOpenInfo } from "./payment-open";

export const DUNNING_REMINDER_DAYS = 3;
export const DUNNING_STEP_DAYS = 14;
export const DUNNING_FINAL_DAYS = 7;
/** Nach so vielen Fehlversuchen einer Stufe nicht mehr automatisch versuchen. */
export const DUNNING_MAX_FAILED = 3;

export type DunningStage = "reminder" | "first" | "final" | "collection";

export interface DunningState {
  /** Erinnerung verschickt (ISO). */
  reminderAt?: string;
  /** „anny“ = anny hat die Erinnerung verschickt, „mail“ = eigene Mail. */
  reminderVia?: "anny" | "mail";
  firstAt?: string;
  /** Zahlungsfrist der 1. Mahnung, YYYY-MM-DD. */
  firstDeadline?: string;
  finalAt?: string;
  /** Zahlungsfrist der letzten Mahnung, YYYY-MM-DD. */
  finalDeadline?: string;
  /** Frist der letzten Mahnung abgelaufen: bereit für Inkasso. */
  collectionAt?: string;
  /** Letzter Fehlversuch der anstehenden Stufe. */
  failedStage?: DunningStage;
  failedCount?: number;
  failedError?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Liest `extras.paymentPause.dunning`; leer, wenn noch nichts passiert ist. */
export function dunningState(extras: unknown): DunningState {
  if (!extras || typeof extras !== "object" || Array.isArray(extras)) return {};
  const pay = (extras as Record<string, unknown>).paymentPause;
  if (!pay || typeof pay !== "object" || Array.isArray(pay)) return {};
  const d = (pay as Record<string, unknown>).dunning;
  if (!d || typeof d !== "object" || Array.isArray(d)) return {};
  const r = d as Record<string, unknown>;
  const stage = str(r.failedStage);
  return {
    reminderAt: str(r.reminderAt),
    reminderVia: r.reminderVia === "anny" || r.reminderVia === "mail" ? r.reminderVia : undefined,
    firstAt: str(r.firstAt),
    firstDeadline: str(r.firstDeadline),
    finalAt: str(r.finalAt),
    finalDeadline: str(r.finalDeadline),
    collectionAt: str(r.collectionAt),
    failedStage: stage === "reminder" || stage === "first" || stage === "final" || stage === "collection" ? stage : undefined,
    failedCount: typeof r.failedCount === "number" ? r.failedCount : undefined,
    failedError: str(r.failedError),
  };
}

/** Ganze Berlin-Kalendertage von `fromIso` bis `now`. */
function daysSince(fromIso: string, now: Date): number {
  const a = Date.parse(`${berlinYmd(fromIso)}T00:00:00Z`);
  const b = Date.parse(`${berlinYmd(now)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return -1;
  return Math.round((b - a) / 86_400_000);
}

/** Beginn des Verzugs für den Mahnlauf: Beginn der Pause, sonst Fälligkeit. */
export function dunningStart(info: Pick<PaymentOpenInfo, "since" | "dueDate">): string | null {
  return info.since ?? info.dueDate ?? null;
}

/** Erreichte Stufe; null, wenn heute nichts ansteht. */
export function dueDunningStage(start: string | null, d: DunningState, now: Date = new Date()): DunningStage | null {
  if (d.collectionAt) return null;
  if (!d.reminderAt) {
    if (!start || daysSince(start, now) < DUNNING_REMINDER_DAYS) return null;
    return "reminder";
  }
  if (!d.firstAt) return daysSince(d.reminderAt, now) >= DUNNING_STEP_DAYS ? "first" : null;
  if (!d.finalAt) return daysSince(d.firstAt, now) >= DUNNING_STEP_DAYS ? "final" : null;
  return daysSince(d.finalAt, now) >= DUNNING_FINAL_DAYS ? "collection" : null;
}

/** Nächste Stufe und ab wann (YYYY-MM-DD); null nach „bereit für Inkasso“. */
export function nextDunningStep(start: string | null, d: DunningState): { stage: DunningStage; on: string } | null {
  if (d.collectionAt) return null;
  if (!d.reminderAt) return start ? { stage: "reminder", on: addCalendarDays(berlinYmd(start), DUNNING_REMINDER_DAYS) } : null;
  if (!d.firstAt) return { stage: "first", on: addCalendarDays(berlinYmd(d.reminderAt), DUNNING_STEP_DAYS) };
  if (!d.finalAt) return { stage: "final", on: addCalendarDays(berlinYmd(d.firstAt), DUNNING_STEP_DAYS) };
  return { stage: "collection", on: addCalendarDays(berlinYmd(d.finalAt), DUNNING_FINAL_DAYS) };
}

export const DUNNING_STAGE_LABEL: Record<DunningStage, string> = {
  reminder: "Zahlungserinnerung",
  first: "1. Mahnung",
  final: "Letzte Mahnung",
  collection: "Bereit für Inkasso",
};

/** Zuletzt erreichte Stufe; null vor der Erinnerung. */
export function reachedDunningStage(d: DunningState): DunningStage | null {
  if (d.collectionAt) return "collection";
  if (d.finalAt) return "final";
  if (d.firstAt) return "first";
  if (d.reminderAt) return "reminder";
  return null;
}

/** Stand nach erledigter Stufe (Fehlerzähler zurückgesetzt). */
export function applyDunningStage(
  d: DunningState,
  stage: DunningStage,
  now: Date,
  via: "anny" | "mail" = "mail",
): DunningState {
  const at = now.toISOString();
  const today = berlinYmd(now);
  const next: DunningState = { ...d };
  delete next.failedStage;
  delete next.failedCount;
  delete next.failedError;
  if (stage === "reminder") {
    next.reminderAt = at;
    next.reminderVia = via;
  } else if (stage === "first") {
    next.firstAt = at;
    next.firstDeadline = addCalendarDays(today, DUNNING_STEP_DAYS);
  } else if (stage === "final") {
    next.finalAt = at;
    next.finalDeadline = addCalendarDays(today, DUNNING_FINAL_DAYS);
  } else {
    next.collectionAt = at;
  }
  return next;
}

/** Stand nach einem Fehlversuch. */
export function failDunningStage(d: DunningState, stage: DunningStage, error: string): DunningState {
  const count = d.failedStage === stage ? (d.failedCount ?? 0) + 1 : 1;
  return { ...d, failedStage: stage, failedCount: count, failedError: error.slice(0, 300) };
}

/** Zu oft gescheitert: nur noch in der Liste zeigen, nicht mehr versuchen. */
export function dunningStuck(d: DunningState, stage: DunningStage): boolean {
  return d.failedStage === stage && (d.failedCount ?? 0) >= DUNNING_MAX_FAILED;
}


// ---------------------------------------------------------------------------
// Einstellungen (ApiConfig ANNY, extraConfig.dunning)
// ---------------------------------------------------------------------------

export interface DunningConfig {
  enabled: boolean;
}

export function parseDunningConfig(extraConfig: string | null | undefined): DunningConfig {
  if (!extraConfig) return { enabled: true };
  try {
    const parsed = JSON.parse(extraConfig) as { dunning?: { enabled?: unknown } };
    return { enabled: parsed?.dunning?.enabled !== false };
  } catch {
    return { enabled: true };
  }
}

