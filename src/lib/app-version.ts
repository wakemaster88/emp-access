/**
 * Versionsstand der Cloud-App für den Update-Hinweis.
 *
 * `NEXT_PUBLIC_BUILD_ID` setzt next.config.ts beim Build (Vercel-Deployment-ID,
 * sonst Commit). Der Browser kennt damit den Stand, mit dem er geladen wurde;
 * `/api/version` liefert den Stand, der gerade ausgeliefert wird. Weichen beide
 * ab, ist eine neue Version deployt.
 */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
/** ISO-Zeitpunkt des Builds (next.config.ts), leer ohne Build-Env. */
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME || "";

/** Ohne Vercel-Env (lokal, CI) gibt es keinen belastbaren Vergleich. */
export function isNewerBuild(current: string, served: string | null | undefined): boolean {
  if (!served || current === "dev" || served === "dev") return false;
  return served !== current;
}

/**
 * Seiten ohne Person davor: Monitore, Scanner und Check-in-Kiosk laden eine
 * neue Version selbst, sobald eine Minute lang niemand getippt hat. Alle
 * anderen Seiten fragen per Dialog.
 */
const KIOSK_PREFIXES = ["/monitor/", "/resource-monitor/", "/scanner/", "/checkin/", "/gutscheine/"];

export function isKioskPath(pathname: string): boolean {
  return KIOSK_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Öffentliche Seiten (Kunden-App, Infoseiten, Kiosk): dort zeigt der
 * Update-Hinweis keine Neuerungen, denn die Liste stammt aus den PR-Titeln
 * und richtet sich an das Team.
 */
const PUBLIC_PREFIXES = ["/app/", "/zaehlen/", "/m/", "/info/", "/verein/", "/schluessel/", "/checkin/", "/monitor/", "/resource-monitor/", "/scanner/", "/gutscheine/"];

export function showsReleaseNotes(pathname: string): boolean {
  return !PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export interface MergedPull {
  title: string;
  merged_at: string | null;
}

/** PR-Titel, die nichts für Nutzer bedeuten. */
const SKIP_TITLE = /^(revert|bump|chore|ci\b|build\b|deps?\b|intern\b|\[intern\])/i;

/** Höchstens so viele Neuerungen im Dialog, der Rest als „und N weitere“. */
export const MAX_RELEASE_NOTES = 8;

/**
 * Neuerungen zwischen zwei Builds: Titel der PRs, die nach dem Build des
 * Browsers (`since`) und spätestens mit dem ausgelieferten Build (`until`)
 * nach main gemergt wurden, neueste zuerst, ohne Doppelte.
 */
export function pickReleaseNotes(pulls: MergedPull[], since: string, until: string): string[] {
  const from = Date.parse(since);
  const to = until ? Date.parse(until) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(from)) return [];
  const seen = new Set<string>();
  return pulls
    .filter((p) => p.merged_at)
    .map((p) => ({ title: p.title.trim(), at: Date.parse(p.merged_at as string) }))
    .filter((p) => p.title && p.at > from && p.at <= to && !SKIP_TITLE.test(p.title))
    .sort((a, b) => b.at - a.at)
    .map((p) => p.title)
    .filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
}
