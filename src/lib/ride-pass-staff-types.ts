/**
 * Datenform des Ride Pass für das Personal (lib/ride-pass-staff). Eigene
 * Datei ohne Datenbank-Import, damit die Client-Komponente sie laden darf.
 */

export interface RidePassTemp {
  /** „17,4 °C“ */
  avg: string;
  /** Spanne oder „gemessen an x von y Tagen“. */
  note: string;
}

export interface RidePassRecap {
  year: number;
  visitDays: number;
  starts: number;
  /** Längste Serie an Wochen in Folge. */
  streakWeeks: number;
  bestMonth: string | null;
  bestWeekday: string | null;
  bestDay: { day: string; starts: number } | null;
  firstDay: string | null;
  lastDay: string | null;
  /** Anteil der anderen Abo-Fahrer mit weniger Besuchstagen (%). */
  aheadOf: number | null;
  air: RidePassTemp | null;
  water: RidePassTemp | null;
  waterSensor: boolean;
}

export interface RidePassStaffView {
  /** Kunden-App im Konto eingeschaltet. */
  enabled: boolean;
  /** Person ohne Ticket und ohne Adresse: es gibt noch nichts zu zeigen. */
  empty: boolean;
  year: number;
  /** Zuletzt in der App, ISO; null = nie. */
  lastSeenAt: string | null;
  nickname: string | null;
  showInRanking: boolean;
  stats: {
    visitDays: number;
    starts: number;
    startsTotal: number;
    streakWeeks: number;
    seasons: number;
    seasonsSince: number | null;
    /** Erreichte Stufe der Saison (Award für Besuchstage). */
    level: string | null;
  } | null;
  /** Laufende und vergangene Saison, jeweils nur mit Besuchstagen. */
  recaps: RidePassRecap[];
  awards: {
    /** Im laufenden Zeitraum (oder einmalig) vergeben, jüngste zuerst. */
    unlocked: Array<{ id: number; name: string; tier: string; tierRank: number; category: string; text: string; awardedAt: string | null }>;
    /** Aktive Awards im Konto. */
    total: number;
    /** Am nächsten dran, mit Stand. */
    next: Array<{ id: number; name: string; value: number; threshold: number; remaining: string }>;
    /** In einer früheren Saison vergeben, in der laufenden noch offen. */
    earlier: Array<{ id: number; name: string; period: string }>;
  };
  /** Laufende und in den letzten 30 Tagen beendete Challenges. */
  challenges: Array<{
    id: number;
    name: string;
    running: boolean;
    won: boolean;
    /** „Aufgabe“ oder „Top 3“. */
    kind: string;
    /** Stand der Person, fertig formuliert. */
    standing: string;
    endDate: string;
    voucherLabel: string | null;
  }>;
  vouchers: Array<{
    id: number;
    code: string;
    label: string;
    /** Award, aus dem der Gutschein stammt. */
    award: string | null;
    state: "open" | "redeemed" | "expired";
    expiresAt: string | null;
    redeemedAt: string | null;
  }>;
}
