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

// ---------------------------------------------------------------------------
// Übersicht: Entwicklung der Abonnenten
// ---------------------------------------------------------------------------

/** Herkünfte mit Double-Opt-in: angemeldet erst ab der Bestätigung. */
const DOUBLE_OPT_IN_SOURCES = new Set(["website", "app", "verwaltung", "kasse"]);

export interface TimelineSubscriber {
  status: string;
  source: string;
  confirmedAt: Date | null;
  consentAt: Date | null;
  createdAt: Date;
  unsubscribedAt: Date | null;
  bouncedAt: Date | null;
  complainedAt: Date | null;
}

/**
 * Zeitraum, in dem eine Adresse angemeldet war. Double-Opt-in-Adressen ab
 * der Bestätigung, übernommene (alte Website-Liste, Wakesys, anny) ab dem
 * Eintrag. Nie angemeldet: null. Wer jetzt angemeldet ist, zählt immer mit,
 * damit der letzte Punkt zur Zahl „Angemeldet“ passt.
 */
export function activeSpan(s: TimelineSubscriber): { from: Date; to: Date | null } | null {
  const imported = !DOUBLE_OPT_IN_SOURCES.has(s.source) || s.status === "ACTIVE";
  const from = s.confirmedAt ?? (imported ? (s.consentAt ?? s.createdAt) : null);
  if (!from) return null;
  if (s.status === "ACTIVE") return { from, to: null };
  const to = s.unsubscribedAt ?? s.bouncedAt ?? s.complainedAt;
  if (s.status === "PENDING" || !to) return null;
  return { from, to };
}

export interface TimelinePoint {
  /** Ende des Abschnitts. */
  end: Date;
  /** Angemeldet am Ende des Abschnitts. */
  active: number;
  /** Im Abschnitt dazugekommen. */
  joined: number;
  /** Im Abschnitt abgemeldet, unzustellbar oder als Spam gemeldet. */
  left: number;
}

const DAY_MS = 86_400_000;

/** Angemeldete je Woche, die letzte Woche endet jetzt. */
export function subscriberTimeline(rows: TimelineSubscriber[], weeks: number, now: Date = new Date()): TimelinePoint[] {
  const spans = rows.map(activeSpan).filter((s): s is { from: Date; to: Date | null } => !!s);
  const points: TimelinePoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = now.getTime() - i * 7 * DAY_MS;
    const start = end - 7 * DAY_MS;
    let active = 0;
    let joined = 0;
    let left = 0;
    for (const s of spans) {
      const from = s.from.getTime();
      const to = s.to?.getTime() ?? null;
      if (from <= end && (to === null || to > end)) active++;
      if (from > start && from <= end) joined++;
      if (to !== null && to > start && to <= end) left++;
    }
    points.push({ end: new Date(end), active, joined, left });
  }
  return points;
}

/** Dazugekommen und gegangen in den letzten Tagen. */
export function recentChange(rows: TimelineSubscriber[], days: number, now: Date = new Date()): { joined: number; left: number } {
  const since = now.getTime() - days * DAY_MS;
  let joined = 0;
  let left = 0;
  for (const r of rows) {
    const s = activeSpan(r);
    if (!s) continue;
    if (s.from.getTime() > since && s.from.getTime() <= now.getTime()) joined++;
    if (s.to && s.to.getTime() > since && s.to.getTime() <= now.getTime()) left++;
  }
  return { joined, left };
}
