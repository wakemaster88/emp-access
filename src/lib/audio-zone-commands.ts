/**
 * Rückmeldung zu Start und Stopp einer Audio-Zone im Dashboard: wann ein
 * Befehl als bestätigt, gescheitert oder verschollen gilt. Rein rechnend,
 * damit es sich ohne Browser testen lässt (`audio-zone-commands.test.ts`).
 */

/** Was die Rechnung von Zone und Verlauf braucht (Ausschnitt aus `/api/audio/status`). */
export interface ZoneLiveState {
  isPlaying: boolean;
  externalActive: string | null;
  deviceOnline: boolean;
}

export interface ZoneJobState {
  zoneId: number;
  kind: string;
  status: "PENDING" | "SENT" | "PLAYING" | "DONE" | "FAILED";
  errorMessage: string | null;
  createdAt: string;
}

export type ZoneCommandAction = "PLAY" | "STOP";

/**
 * Rückmeldung zu Start und Stopp einer Zone.
 *
 * - `sending`: die Cloud nimmt den Befehl gerade an.
 * - `waiting`: der Befehl liegt beim Abspieler, die Zone hat ihn noch nicht bestätigt.
 * - `failed`: abgelehnt, fehlgeschlagen oder nach der Wartezeit ohne Wirkung –
 *   `message` sagt, woran es liegt.
 */
export interface ZoneCommandState {
  action: ZoneCommandAction;
  phase: "sending" | "waiting" | "failed";
  /** Zeitpunkt des Absendens (ms), für Wartezeit und Zuordnung im Verlauf. */
  since: number;
  message?: string;
}

/**
 * Der Abspieler holt Befehle alle acht Sekunden ab und meldet Start und Stopp
 * gleich danach. Nach 45 s ohne Wirkung ist das kein Warten mehr, sondern ein
 * Problem, das die Karte benennen muss.
 */
export const COMMAND_TIMEOUT_MS = 45_000;

/** Server- und Browseruhr liegen selten genau gleich. */
const CLOCK_SKEW_MS = 10_000;

/** Ein bestätigter Befehl verschwindet nach dieser Zeit wieder. */
export const FAILED_VISIBLE_MS = 60_000;


/** Neue Map nur, wenn sich mindestens ein Eintrag ändert. */
export function resolveCommands(
  commands: Map<number, ZoneCommandState>,
  liveZones: Map<number, ZoneLiveState>,
  liveJobs: ZoneJobState[] | null,
  now: number
): Map<number, ZoneCommandState> {
  let next: Map<number, ZoneCommandState> | null = null;
  const update = (zoneId: number, state: ZoneCommandState | null) => {
    next ??= new Map(commands);
    if (state) next.set(zoneId, state);
    else next.delete(zoneId);
  };

  for (const [zoneId, command] of commands) {
    if (command.phase === "failed") {
      if (now - command.since > FAILED_VISIBLE_MS) update(zoneId, null);
      continue;
    }
    if (command.phase !== "waiting") continue;

    const zone = liveZones.get(zoneId);
    const job = latestJob(liveJobs, zoneId, command);

    // Ziel erreicht: die Zone meldet den gewünschten Zustand. Eine Übernahme
    // per AirPlay/Bluetooth zählt als „läuft“ – die eigene Quelle wartet dann.
    const reached =
      command.action === "PLAY"
        ? !!zone && (zone.isPlaying || zone.externalActive !== null)
        : !!zone && !zone.isPlaying;
    if (reached && (!job || job.status === "DONE")) {
      update(zoneId, null);
      continue;
    }

    if (job?.status === "FAILED") {
      update(zoneId, {
        ...command,
        phase: "failed",
        message: job.errorMessage
          ? `${failedVerb(command.action)}: ${job.errorMessage}`
          : `${failedVerb(command.action)} · Verlauf prüfen`,
      });
      continue;
    }

    if (now - command.since < COMMAND_TIMEOUT_MS) continue;

    update(zoneId, { ...command, phase: "failed", message: timeoutMessage(command, zone, job) });
  }

  return next ?? commands;
}

function failedVerb(action: ZoneCommandAction): string {
  return action === "PLAY" ? "Start fehlgeschlagen" : "Stopp fehlgeschlagen";
}

/** Was nach Ablauf der Wartezeit am wahrscheinlichsten fehlt. */
function timeoutMessage(
  command: ZoneCommandState,
  zone: ZoneLiveState | undefined,
  job: ZoneJobState | null
): string {
  if (zone && !zone.deviceOnline) {
    return "Abspieler ist offline · der Befehl wird ausgeführt, sobald er sich meldet";
  }
  if (job && (job.status === "PENDING" || job.status === "SENT")) {
    return "Abspieler hat den Befehl noch nicht abgeholt · Verbindung des Abspielers prüfen";
  }
  return command.action === "PLAY"
    ? "Abspieler meldet keine Wiedergabe · Quelle der Zone prüfen"
    : "Abspieler meldet weiter Wiedergabe · erneut stoppen";
}

/** Der Job, den dieser Befehl ausgelöst hat: der jüngste passende seit dem Absenden. */
function latestJob(
  jobs: ZoneJobState[] | null,
  zoneId: number,
  command: ZoneCommandState
): ZoneJobState | null {
  if (!jobs) return null;
  for (const job of jobs) {
    if (job.zoneId !== zoneId || job.kind !== command.action) continue;
    if (new Date(job.createdAt).getTime() < command.since - CLOCK_SKEW_MS) continue;
    return job;
  }
  return null;
}
