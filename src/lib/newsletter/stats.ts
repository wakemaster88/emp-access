/**
 * Zahlen einer Aussendung aus den Zuständen ihrer Empfänger. Ohne
 * Datenbank, damit Seite und Tests dieselbe Rechnung nutzen.
 */

export interface CampaignStats {
  /** Alle Empfänger der Aussendung. */
  total: number;
  /** Noch in der Warteschlange oder gerade beim Senden. */
  waiting: number;
  /** An SES übergeben (auch wenn später zurückgekommen). */
  sent: number;
  /** Laut SES im Postfach angekommen. */
  delivered: number;
  bounced: number;
  complained: number;
  /** Nach mehreren Versuchen aufgegeben. */
  failed: number;
  /** Nicht verschickt, weil abgebrochen oder vorher abgemeldet. */
  skipped: number;
  /** Über den Link dieser Aussendung abgemeldet. */
  unsubscribed: number;
  /** Anteil erledigter Empfänger, 0 bis 100. */
  progress: number;
}

export function campaignStats(
  groups: Array<{ status: string; count: number }>,
  unsubscribed = 0,
): CampaignStats {
  const n = (...statuses: string[]) =>
    groups.filter((g) => statuses.includes(g.status)).reduce((sum, g) => sum + g.count, 0);
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  const waiting = n("QUEUED", "SENDING");
  return {
    total,
    waiting,
    sent: n("SENT", "DELIVERED", "BOUNCED", "COMPLAINED"),
    delivered: n("DELIVERED", "COMPLAINED"),
    bounced: n("BOUNCED"),
    complained: n("COMPLAINED"),
    failed: n("FAILED"),
    skipped: n("SKIPPED"),
    unsubscribed,
    progress: total > 0 ? Math.round(((total - waiting) / total) * 100) : 0,
  };
}

/** „12 %“ eines Bezugs, ohne Bezug ein Strich. */
export function percent(part: number, of: number): string {
  if (of <= 0) return "–";
  const p = (part / of) * 100;
  return `${p > 0 && p < 1 ? p.toFixed(1).replace(".", ",") : Math.round(p)} %`;
}
