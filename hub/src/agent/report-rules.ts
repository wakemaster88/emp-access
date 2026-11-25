/**
 * Tagesbericht: wann er dran ist. Reine Logik, ohne Uhr.
 *
 * Der Bericht ist einmal am Tag ab der Berichtszeit faellig. Erledigt ist der
 * Tag erst, wenn der Bericht einen Chat erreicht hat. Bis dahin wird er nach
 * einer Pause erneut gesendet (derselbe Text, er wird nicht neu geschrieben).
 */

/** Pause nach einem Bericht, der nach allen Versuchen der Warteschlange keinen Chat erreicht hat. */
export const REPORT_RETRY_MS = 5 * 60_000;
/** Pause, wenn Telegram den Bericht fuer jeden Chat abgelehnt hat. */
export const REPORT_REJECTED_RETRY_MS = 60 * 60_000;

export interface ReportClock {
  /** Datum der Ortszeit (JJJJ-MM-TT). */
  today: string;
  /** Uhrzeit der Ortszeit (HH:MM). */
  hhmm: string;
  /** Berichtszeit (HH:MM). */
  reportTime: string;
  /** Tag, an dem zuletzt ein Bericht zugestellt wurde. */
  lastReportDay: string | null;
  /** Ein Bericht wird gerade geschrieben oder gesendet. */
  busy: boolean;
  /** Fruehester naechster Versuch nach einem gescheiterten (ms). */
  retryAt: number;
  now: number;
}

export function reportDue(c: ReportClock): boolean {
  if (c.lastReportDay === c.today || c.hhmm < c.reportTime) return false;
  return !c.busy && c.now >= c.retryAt;
}

/** Pause bis zum naechsten Versuch nach einem Bericht, der keinen Chat erreicht hat. */
export function reportRetryMs(rejected: boolean): number {
  return rejected ? REPORT_REJECTED_RETRY_MS : REPORT_RETRY_MS;
}
