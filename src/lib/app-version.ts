/**
 * Versionsstand der Cloud-App für den Update-Hinweis.
 *
 * `NEXT_PUBLIC_BUILD_ID` setzt next.config.ts beim Build (Vercel-Deployment-ID,
 * sonst Commit). Der Browser kennt damit den Stand, mit dem er geladen wurde;
 * `/api/version` liefert den Stand, der gerade ausgeliefert wird. Weichen beide
 * ab, ist eine neue Version deployt.
 */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

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
const KIOSK_PREFIXES = ["/monitor/", "/resource-monitor/", "/scanner/", "/checkin/"];

export function isKioskPath(pathname: string): boolean {
  return KIOSK_PREFIXES.some((p) => pathname.startsWith(p));
}
