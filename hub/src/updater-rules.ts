/**
 * Entscheidungen des Selbst-Updates – reine Logik ohne Hub-Konfiguration
 * (testbar, updater-rules.test.ts). Ablauf in updater.ts.
 */

/**
 * Pre-Flight-Vertrag zwischen dem LAUFENDEN (alten) Updater und dem NEUEN
 * Stand: Der Updater startet `npx tsx src/index.ts` mit HUB_PREFLIGHT=1.
 * index.ts laedt dann nur den Modulgraphen (Syntax, Importe, Abhaengigkeiten),
 * gibt PREFLIGHT_OK aus und beendet sich, ohne irgendetwas zu starten.
 *
 * NIE umbenennen oder aus index.ts entfernen: Der alte Updater kennt nur
 * diese Namen. Fehlt die Antwort, gilt jeder neue Stand als kaputt und der
 * Hub aktualisiert sich nicht mehr (dann hilft nur hub/install/update.sh).
 */
export const PREFLIGHT_ENV = "HUB_PREFLIGHT";
export const PREFLIGHT_OK = "HUB_PREFLIGHT_OK";

export function isPreflightRun(env: Record<string, string | undefined>): boolean {
  return env[PREFLIGHT_ENV] === "1";
}

/**
 * Installation: mit Lockfile `npm ci` (genau der gepruefte Stand, aendert
 * das Lockfile nie), sonst wie bisher `npm install`. --prefer-offline nimmt
 * den lokalen npm-Cache, damit ein Netzaussetzer die Installation nicht kippt.
 */
export function installCommand(hasLockfile: boolean): { args: string[]; label: string } {
  return hasLockfile
    ? { args: ["ci", "--no-audit", "--no-fund", "--prefer-offline"], label: "npm ci" }
    : { args: ["install", "--no-audit", "--no-fund"], label: "npm install" };
}

/** HUB_UPDATE_VERIFY_SIGNATURE: nur ausdruecklich eingeschaltet aktiv. */
export function signatureCheckEnabled(value: string | undefined): boolean {
  return /^(1|true|on|yes|ja)$/i.test((value ?? "").trim());
}

export interface RejectedUpdate {
  /** Commit, der abgelehnt wurde (Signatur, Installation oder Pre-Flight). */
  rev: string;
  at: number;
}

/**
 * Ein abgelehnter Stand wird nicht alle fuenf Minuten erneut probiert:
 * erst nach `waitMs` – oder sofort, sobald ein anderer Commit da ist.
 */
export function retryBlocked(
  rejected: RejectedUpdate | null,
  rev: string,
  now: number,
  waitMs: number
): boolean {
  return !!rejected && rejected.rev === rev && now - rejected.at < waitMs;
}
