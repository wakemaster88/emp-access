/**
 * Reine Pruefungen auf dem Plan fuer den Notbetrieb (`GET /api/hub/rules`).
 *
 * Die Cloud rechnet Wochentage, Zeitfenster, Betriebszeit und Dunkelheit vor
 * (src/lib/room-rules.ts, `allowedIntervals`); der Hub prueft nur noch, ob
 * ein Zeitpunkt in einem der Zeitraeume liegt. Ein Nachtfenster „nur
 * Samstag, 22–8 Uhr“ kommt so als ein Zeitraum Samstag 22 Uhr bis Sonntag
 * 8 Uhr an.
 */

export interface PlanInterval {
  from: string;
  to: string;
}

/** Liegt `now` (ms) in einem der Zeitraeume [from, to)? */
export function inAllowed(allowed: PlanInterval[], now: number): boolean {
  return allowed.some((i) => now >= Date.parse(i.from) && now < Date.parse(i.to));
}

/**
 * Optionen fuer das Schalten einer Geraete-Aktion des Plans im Notbetrieb:
 * nur im LAN, dazu die Selbstabschaltung der Aktion. Ob sie beim Geraet
 * wirkt, entscheidet deviceAction (rooms-rules.ts, `ruleAutoOffSec`).
 */
export function localActionOptions(action: { timerSeconds?: number | null }): {
  localOnly: true;
  autoOffSec?: number;
} {
  const t = action.timerSeconds;
  return t != null && Number.isFinite(t) && t > 0 ? { localOnly: true, autoOffSec: t } : { localOnly: true };
}

/* ------------------------------------------------------- Plan neu holen */

/** Ohne Regel-Version (aeltere Cloud) und nach einem gescheiterten Abruf: der bisherige Takt. */
export const PLAN_REFRESH_MS = 15 * 60_000;

/**
 * Mit Regel-Version: Aenderungen an Regeln, Raeumen und Betriebszeiten kommen
 * ueber das Lebenszeichen sofort (src/lib/rule-version.ts); der feste Abruf
 * schiebt nur das Ende des Plans nach. Der Plan reicht 48 Stunden, und der
 * Notbetrieb beginnt fruehestens 3 Minuten nach dem letzten Kontakt zur
 * Cloud. Ein hoechstens 6 Stunden alter Plan haelt damit jeden Termin und
 * jeden erlaubten Zeitraum der ersten knapp 42 Stunden Notbetrieb.
 */
export const PLAN_REFRESH_VERSIONED_MS = 6 * 3_600_000;

/** Neue Version: frueheste Wiederholung nach einem Versuch (ein Lebenszeichen-Takt). */
export const PLAN_VERSION_RETRY_MS = 60_000;

export interface PlanRefreshState {
  /** Letzter erfolgreicher Abruf (ms); null = noch keiner. */
  fetchedAt: number | null;
  /** Letzter Versuch, auch gescheitert (ms); null = noch keiner. */
  attemptAt: number | null;
  /** Version, zu der der geholte Plan passt; null = die Cloud nannte keine. */
  planVersion: string | null;
  /** Version aus dem letzten Lebenszeichen; null = die Cloud nennt keine. */
  cloudVersion: string | null;
}

/** Ist es Zeit, den Plan neu zu holen? Eine zurueckgestellte Uhr zaehlt als abgelaufen. */
export function planRefreshDue(s: PlanRefreshState, now: number): boolean {
  const elapsed = (at: number | null, limit: number) => at === null || now < at || now - at >= limit;
  if (s.fetchedAt === null) return elapsed(s.attemptAt, PLAN_REFRESH_MS);
  if (s.cloudVersion === null) return elapsed(s.fetchedAt, PLAN_REFRESH_MS) && elapsed(s.attemptAt, PLAN_REFRESH_MS);
  if (s.cloudVersion !== s.planVersion) return elapsed(s.attemptAt, PLAN_VERSION_RETRY_MS);
  return elapsed(s.fetchedAt, PLAN_REFRESH_VERSIONED_MS) && elapsed(s.attemptAt, PLAN_REFRESH_MS);
}
