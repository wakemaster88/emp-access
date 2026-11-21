/**
 * „Zahlung offen“ bei anny-Abos.
 *
 * Der anny-Abgleich pausiert ein Abo, wenn eine Abo-Rechnung überfällig ist,
 * und legt am Ticket `extras.paymentPause` ab (siehe lib/anny-sync). Diese
 * Datei liest den Vermerk einheitlich für Scanner, Kasse, Abos-Seite und
 * Kunden-App und formatiert ihn.
 */
import type { PrismaClient } from "@prisma/client";
import {
  DUNNING_STAGE_LABEL, dunningStart, dunningState, dunningStuck, nextDunningStep, reachedDunningStage,
  type DunningStage,
} from "./dunning-state";

export interface PaymentOpenInfo {
  /** Betrag der ältesten offenen Rechnung. */
  amount: number | null;
  /** Summe aller offenen Abo-Rechnungen (seit dem Abgleich vom 21.11.2026). */
  openTotal: number | null;
  /** Anzahl offener Abo-Rechnungen. */
  openCount: number | null;
  currency: string | null;
  /** Fälligkeit der ältesten offenen Rechnung, ISO. */
  dueDate: string | null;
  invoiceNumber: string | null;
  /** anny-id der ältesten offenen Rechnung (für die Zahlungserinnerung). */
  invoiceId: string | null;
  /** Seit wann das Abo deswegen pausiert ist, ISO. */
  since: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Liest `extras.paymentPause`; null, wenn das Ticket keinen Vermerk hat. */
export function paymentOpenInfo(extras: unknown): PaymentOpenInfo | null {
  if (!extras || typeof extras !== "object" || Array.isArray(extras)) return null;
  const p = (extras as Record<string, unknown>).paymentPause;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const r = p as Record<string, unknown>;
  return {
    amount: num(r.amount),
    openTotal: num(r.openTotal),
    openCount: num(r.openCount),
    currency: str(r.currency),
    dueDate: str(r.dueDate),
    invoiceNumber: str(r.invoiceNumber),
    invoiceId: str(r.invoiceId),
    since: str(r.since),
  };
}

/** Offener Betrag: Summe aller offenen Rechnungen, sonst die älteste. */
export function openAmount(info: PaymentOpenInfo): number | null {
  return info.openTotal ?? info.amount;
}

export function formatMoney(amount: number | null, currency: string | null = "EUR"): string | null {
  if (amount == null) return null;
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: (currency ?? "EUR").toUpperCase(),
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency ?? "€"}`;
  }
}

export function formatDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
}

/** Ganze Tage seit der Fälligkeit (0 = heute fällig); null ohne Datum. */
export function daysOverdue(info: PaymentOpenInfo, now: Date = new Date()): number | null {
  if (!info.dueDate) return null;
  const due = Date.parse(info.dueDate);
  if (!Number.isFinite(due)) return null;
  return Math.max(0, Math.floor((now.getTime() - due) / (24 * 60 * 60 * 1000)));
}

/** Kurztext für Scanner-Displays: „Zahlung offen · 24 €“. */
export function paymentOpenScanMessage(info: PaymentOpenInfo | null): string {
  const money = info ? formatMoney(openAmount(info), info.currency) : null;
  return money ? `Zahlung offen · ${money}` : "Zahlung offen";
}

/** Ein Satz für Kasse und App: „24 € offen, fällig seit 21.10.2026 (31 Tage).“ */
export function paymentOpenSentence(info: PaymentOpenInfo, now: Date = new Date()): string {
  const money = formatMoney(openAmount(info), info.currency);
  const due = formatDay(info.dueDate);
  const days = daysOverdue(info, now);
  const count = info.openCount && info.openCount > 1 ? ` aus ${info.openCount} Rechnungen` : "";
  const head = money ? `${money} offen${count}` : "Eine Abo-Rechnung ist offen";
  if (!due) return `${head}.`;
  const tail = days != null && days > 0 ? ` (${days} ${days === 1 ? "Tag" : "Tage"})` : "";
  return `${head}, fällig seit ${due}${tail}.`;
}

export interface PaymentOpenRow {
  id: number;
  person: string;
  aboName: string | null;
  email: string | null;
  amount: number | null;
  currency: string | null;
  dueDate: string | null;
  daysOverdue: number | null;
  invoiceNumber: string | null;
  openCount: number | null;
  /** Mahnlauf: zuletzt erreichte Stufe und die nächste (lib/dunning). */
  dunning: DunningSummary;
}

/** Abos mit „Zahlung offen“, älteste Schuld zuerst. */
export async function loadPaymentOpen(
  db: PrismaClient,
  accountId: number,
  now: Date = new Date(),
): Promise<PaymentOpenRow[]> {
  const tickets = await db.ticket.findMany({
    where: { accountId, status: "PAUSED", subscriptionId: { not: null } },
    select: {
      id: true, name: true, firstName: true, lastName: true, email: true,
      ticketTypeName: true, extras: true, subscription: { select: { name: true } },
    },
    take: 2000,
  });
  const rows: PaymentOpenRow[] = [];
  for (const t of tickets) {
    const info = paymentOpenInfo(t.extras);
    if (!info) continue;
    rows.push({
      id: t.id,
      person: [t.firstName, t.lastName].filter((v) => v?.trim()).join(" ").trim() || t.name,
      aboName: t.ticketTypeName ?? t.subscription?.name ?? null,
      email: t.email,
      amount: openAmount(info),
      currency: info.currency,
      dueDate: info.dueDate,
      daysOverdue: daysOverdue(info, now),
      invoiceNumber: info.invoiceNumber,
      openCount: info.openCount,
      dunning: dunningSummary(info, t.extras),
    });
  }
  return sortPaymentOpen(rows);
}

export function sortPaymentOpen<T extends { dueDate: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
}

/** Summe je Währung, für die Überschrift der Liste. */
export function paymentOpenTotal(rows: Array<{ amount: number | null; currency: string | null }>): string | null {
  const byCur = new Map<string, number>();
  for (const r of rows) {
    if (r.amount == null) continue;
    const c = (r.currency ?? "EUR").toUpperCase();
    byCur.set(c, (byCur.get(c) ?? 0) + r.amount);
  }
  if (byCur.size === 0) return null;
  return [...byCur.entries()].map(([c, v]) => formatMoney(Math.round(v * 100) / 100, c)).join(" + ");
}

export interface DunningSummary {
  /** Zuletzt erreichte Stufe, null vor der Erinnerung. */
  stage: DunningStage | null;
  label: string | null;
  /** Wann sie erreicht wurde, ISO. */
  at: string | null;
  /** Nächste Stufe und Tag (YYYY-MM-DD). */
  next: { label: string; on: string } | null;
  /** Fehler der anstehenden Stufe (z. B. keine Adresse). */
  error: string | null;
  /** Nach mehreren Fehlversuchen wird nicht mehr versucht. */
  stuck: boolean;
}

export function dunningSummary(info: PaymentOpenInfo, extras: unknown): DunningSummary {
  const d = dunningState(extras);
  const stage = reachedDunningStage(d);
  const at = stage === "collection" ? d.collectionAt : stage === "final" ? d.finalAt : stage === "first" ? d.firstAt : d.reminderAt;
  const next = nextDunningStep(dunningStart(info), d);
  return {
    stage,
    label: stage ? DUNNING_STAGE_LABEL[stage] : null,
    at: at ?? null,
    next: next ? { label: DUNNING_STAGE_LABEL[next.stage], on: next.on } : null,
    error: d.failedError ?? null,
    stuck: next ? dunningStuck(d, next.stage) : false,
  };
}
