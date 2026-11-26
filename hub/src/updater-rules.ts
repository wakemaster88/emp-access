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

/**
 * Ruhiger Moment fuer den Neustart nach einem Update: Laeuft ein
 * Kennzeichen-Burst, eine Ansage ueber einen Kamera-Lautsprecher oder ein
 * Auftrag aus der Cloud, wartet der Neustart, hoechstens
 * RESTART_QUIET_MAX_MS. Ein Neustart mitten darin braeche den Burst (und
 * damit das Tor fuer dieses Fahrzeug), die Ansage oder den Auftrag ab. Gilt
 * nur fuer den Neustart nach einem Update; ein Neustart aus der Cloud und
 * SIGTERM warten nicht. Danach folgt wie bisher das Warten auf den Waechter
 * (restartStep, hoechstens 3 min).
 */
export const RESTART_QUIET_MAX_MS = 2 * 60_000;

export interface RestartActivity {
  /** Laufende Kennzeichen-Bursts (cameras.ts). */
  burstsAktiv: number;
  /** Eine Ansage laeuft oder wartet (camera-talk.ts). */
  ansageLaeuft: boolean;
  /** Laufende Auftraege aus der Cloud (task-guard.ts). */
  tasksLaufend: number;
}

const QUIET_LABELS = { burst: "Kennzeichen-Burst", ansage: "Ansage", auftrag: "Auftrag" } as const;

/**
 * Darf der Neustart jetzt? Ja, wenn nichts davon laeuft oder seit
 * `wartetSeitMs` schon 2 Minuten gewartet wurde (`timedOut`).
 * `waitingFor`: was gerade laeuft, in fester Reihenfolge.
 */
export function restartAllowed(
  a: RestartActivity & { wartetSeitMs: number }
): { allowed: boolean; waitingFor: string[]; timedOut: boolean } {
  const waitingFor: string[] = [];
  if (a.burstsAktiv > 0) waitingFor.push(QUIET_LABELS.burst);
  if (a.ansageLaeuft) waitingFor.push(QUIET_LABELS.ansage);
  if (a.tasksLaufend > 0) waitingFor.push(QUIET_LABELS.auftrag);
  if (waitingFor.length === 0) return { allowed: true, waitingFor, timedOut: false };
  if (a.wartetSeitMs >= RESTART_QUIET_MAX_MS) return { allowed: true, waitingFor, timedOut: true };
  return { allowed: false, waitingFor, timedOut: false };
}

function joinDe(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`;
}

/** Die eine Zeile nach dem Warten auf einen ruhigen Moment; null = nicht gewartet. */
export function quietWaitLine(waitedFor: readonly string[], waitedMs: number, stillActive: readonly string[]): string | null {
  if (waitedFor.length === 0) return null;
  const sec = Math.round(Math.max(0, waitedMs) / 1000);
  const base = `Update: Neustart nach ${sec} s Warten auf ${joinDe(waitedFor)}`;
  return stillActive.length
    ? `${base} – Höchstdauer ${RESTART_QUIET_MAX_MS / 60_000} min erreicht, noch aktiv: ${joinDe(stillActive)}`
    : base;
}

/**
 * Ein Schritt des Wartens auf einen ruhigen Moment, vor dem Warten auf den
 * Waechter (restartStep) und vor der Abmeldung des Waechters bei der Cloud:
 * Solange gewartet wird, arbeitet der Hub ganz normal weiter. Die Wartezeit
 * zaehlt mindestens die Runden (je RESTART_POLL_MS), damit eine
 * zurueckgestellte Uhr das Warten nicht verlaengert. `waitedFor` sammelt,
 * worauf gewartet wurde; `line` steht beim Neustart einmal im Log.
 */
export function quietStep(input: {
  activity: RestartActivity;
  /** Seit dem ersten Schritt (Uhr). */
  waitedMs: number;
  /** Nummer des Schritts ab 0. */
  round: number;
  /** Aus dem vorigen Schritt: worauf bisher gewartet wurde. */
  waitedFor: readonly string[];
}): { then: "warten" | "weiter"; line: string | null; waitedFor: string[] } {
  const waited = Math.max(input.waitedMs, input.round * RESTART_POLL_MS);
  const quiet = restartAllowed({ ...input.activity, wartetSeitMs: waited });
  const order = Object.values(QUIET_LABELS) as string[];
  const waitedFor = [...new Set([...input.waitedFor, ...quiet.waitingFor])].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!quiet.allowed) return { then: "warten", line: null, waitedFor };
  return { then: "weiter", line: quietWaitLine(waitedFor, waited, quiet.timedOut ? quiet.waitingFor : []), waitedFor };
}
