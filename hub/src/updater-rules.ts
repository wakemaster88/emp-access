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

/**
 * Neustart nach einem Update: Laeuft eine Bewertung des Waechters, wartet er
 * auf ihr Ende, hoechstens RESTART_HOLD_MAX_MS. Ein Neustart mitten in der
 * Bewertung braeche ihren Alarm ab. In Runden von RESTART_POLL_MS; die Zahl
 * der Runden ist begrenzt, damit ein Sprung der Uhr das Warten nicht
 * verlaengert.
 */
export const RESTART_HOLD_MAX_MS = 3 * 60_000;
export const RESTART_POLL_MS = 2_000;

/**
 * Ein Schritt vor dem Neustart: `busy` laufende Bewertungen, `waitedMs` seit
 * dem ersten Schritt, `round` = Nummer des Schritts ab 0. `line` ist die
 * Zeile fuers Log (null = keine).
 */
export function restartStep(busy: number, waitedMs: number, round: number): { then: "warten" | "neustart"; line: string | null } {
  const sec = Math.round(Math.max(0, waitedMs) / 1000);
  if (!(busy > 0)) {
    return { then: "neustart", line: round > 0 ? `Update: Bewertung des Wächters abgeschlossen, Neustart nach ${sec} s Warten` : null };
  }
  if (waitedMs >= RESTART_HOLD_MAX_MS || round >= Math.ceil(RESTART_HOLD_MAX_MS / RESTART_POLL_MS)) {
    return { then: "neustart", line: `Update: Neustart nach ${sec} s Warten, obwohl noch ${busy} Bewertung(en) des Wächters laufen` };
  }
  if (round === 0) {
    return {
      then: "warten",
      line: `Update: Neustart wartet auf ${busy} laufende Bewertung(en) des Wächters (höchstens ${RESTART_HOLD_MAX_MS / 60_000} min)`,
    };
  }
  return { then: "warten", line: null };
}
