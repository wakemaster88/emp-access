import { berlinYmd } from "./berlin-day";

/**
 * Standort und Abo-Shop der Kunden-App.
 *
 * Die App gehört zur Anlage am Tuttenbrocksee. Abos verkauft anny.co: der
 * Shop wird mit dem offiziellen anny-Widget (Web-Komponente
 * `<a-organization-page>`) direkt in der App eingebettet, genau wie auf
 * tuttenbrocksee.com/shop, nur mit der Liste „Abonnements“ vorne.
 */
export const RIDER_LOCATION = "Tuttenbrocksee";

export const ANNY_WIDGET = {
  script: "https://cdn.anny.co/widget/annyComponents.umd.latest.min.js",
  baseUrl: "https://anny.co",
  organization: "tuttenbrocksee",
  list: "subscriptions",
} as const;

export type AboStatus =
  | { kind: "none" }
  | { kind: "expired"; endDate: Date | null }
  /** Vom anny-Abgleich pausiert, weil eine Abo-Rechnung überfällig ist. */
  | { kind: "paymentOpen"; endDate: Date | null; text: string }
  | { kind: "active"; endDate: Date; daysLeft: number }
  | { kind: "unlimited" };

/** Kalendertage (Europe/Berlin) von heute bis zum letzten Gültigkeitstag; 0 = gilt nur noch heute. */
export function berlinDaysUntil(end: Date, now: Date): number {
  const a = Date.parse(`${berlinYmd(now)}T00:00:00Z`);
  const b = Date.parse(`${berlinYmd(end)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Zustand des aktuellen Abos für die Anzeige: keins, abgelaufen, noch X Tage oder ohne Ende. */
export function aboStatus(
  abo: { endDate: Date | null; active: boolean; paymentOpen?: string | null } | null,
  now: Date = new Date(),
): AboStatus {
  if (!abo) return { kind: "none" };
  if (abo.paymentOpen) return { kind: "paymentOpen", endDate: abo.endDate, text: abo.paymentOpen };
  if (!abo.active) return { kind: "expired", endDate: abo.endDate };
  if (!abo.endDate) return { kind: "unlimited" };
  return { kind: "active", endDate: abo.endDate, daysLeft: Math.max(0, berlinDaysUntil(abo.endDate, now)) };
}

/** "noch 123 Tage", "noch 1 Tag" oder "nur noch heute". */
export function daysLeftText(days: number): string {
  if (days <= 0) return "nur noch heute";
  return days === 1 ? "noch 1 Tag" : `noch ${days} Tage`;
}
