/**
 * Client-sichere Konstanten und Auswertungen fuer Antriebe mit zwei
 * Fahrtrichtungen (Markise, Rolltor/Rollladen). Enthaelt bewusst keinen
 * Netzwerkcode – das Schalten liegt in `src/lib/shelly-cover.ts`.
 */

export type CoverAction = "open" | "close" | "stop";

/** Geraetekategorien, die als Antrieb gesteuert werden. */
export const COVER_CATEGORIES = ["MARKISE", "ROLLTOR"] as const;

/** Volle Fahrzeit, wenn am Geraet nichts hinterlegt ist. */
export const DEFAULT_COVER_RUNTIME_SEC = 60;

/** Obergrenze fuer die konfigurierbare Fahrzeit (10 Minuten). */
export const MAX_COVER_RUNTIME_SEC = 600;

/** Hoechster Kanalindex, den ein Shelly praktisch anbietet. */
export const MAX_COVER_CHANNEL = 3;

export function isCoverCategory(category: string | null | undefined): boolean {
  return category === "MARKISE" || category === "ROLLTOR";
}

/** Antrieb im Sinne dieser Steuerung: Shelly + passende Kategorie. */
export function isCoverDevice(device: { type: string; category: string | null }): boolean {
  return device.type === "SHELLY" && isCoverCategory(device.category);
}

export interface CoverDeviceConfig {
  coverUpChannel: number | null;
  coverDownChannel: number | null;
  coverRuntimeSec: number | null;
}

export interface CoverChannels {
  up: number;
  down: number;
  runtimeSec: number;
}

/**
 * Kanalzuordnung eines Antriebs. `null`, wenn die Konfiguration unbrauchbar ist –
 * insbesondere wenn beide Fahrtrichtungen auf demselben Kanal liegen, denn dann
 * liesse sich die Verriegelung nicht einhalten.
 */
export function coverChannels(device: CoverDeviceConfig): CoverChannels | null {
  const up = device.coverUpChannel;
  const down = device.coverDownChannel;
  if (up == null || down == null) return null;
  if (!Number.isInteger(up) || !Number.isInteger(down)) return null;
  if (up < 0 || down < 0) return null;
  if (up === down) return null;

  const configured = device.coverRuntimeSec;
  const runtimeSec =
    configured != null && configured > 0 && configured <= MAX_COVER_RUNTIME_SEC
      ? configured
      : DEFAULT_COVER_RUNTIME_SEC;

  return { up, down, runtimeSec };
}

/**
 * Wartezeit zwischen Abschalten der Gegenrichtung und Einschalten der
 * Zielrichtung. Gibt dem Relais Zeit zum Abfallen, bevor das zweite anzieht.
 * Nur im Switch-Profil relevant; im Cover-Profil verriegelt der Shelly selbst.
 */
export const COVER_INTERLOCK_MS = 500;

export const COVER_NOT_CONFIGURED =
  "Antrieb ist nicht eingerichtet – für Auf und Zu müssen zwei verschiedene Shelly-Kanäle hinterlegt sein";

/** Wie eine Fahrt auszufuehren ist (`coverDrivePlan`). */
export type CoverDrivePlan =
  /** Cover-Profil: ein Befehl an `cover:N`, der Shelly verriegelt selbst. */
  | { kind: "cover"; coverId: number; action: CoverAction }
  /** Zwei Relais, Stopp: beide abschalten. */
  | { kind: "relays-stop"; channels: [number, number] }
  /**
   * Zwei Relais, Fahrt: erst `release` (Gegenrichtung) abschalten, nur wenn
   * das gelang `pauseMs` warten, dann `move` fuer `runtimeSec` einschalten.
   */
  | { kind: "relays"; release: number; move: number; runtimeSec: number; pauseMs: number }
  /** Keine Fahrt: die Verriegelung liesse sich nicht einhalten. */
  | { kind: "refuse"; error: string };

/**
 * Fahrt eines Antriebs: `coverId` ist der Antrieb im Cover-Profil laut
 * Geraetestatus (`shellyCoverComponentId`), null im Switch-Profil. Dieselbe
 * Rechnung fuehrt der Hub im Notbetrieb aus (hub/src/cover-rules.ts); beide
 * pruefen dieselben Testfaelle (hub/src/cover-interlock-cases.ts).
 */
export function coverDrivePlan(coverId: number | null, device: CoverDeviceConfig, action: CoverAction): CoverDrivePlan {
  if (coverId !== null) return { kind: "cover", coverId, action };
  const channels = coverChannels(device);
  if (!channels) return { kind: "refuse", error: COVER_NOT_CONFIGURED };
  if (action === "stop") return { kind: "relays-stop", channels: [channels.up, channels.down] };
  const move = action === "open" ? channels.up : channels.down;
  const release = action === "open" ? channels.down : channels.up;
  return { kind: "relays", release, move, runtimeSec: channels.runtimeSec, pauseMs: COVER_INTERLOCK_MS };
}

/**
 * Fahrzustand eines Antriebs.
 *
 * `open`/`closed` gibt es nur, wenn der Shelly den Antrieb selbst als Rollladen
 * fuehrt – dann kennt er seine Endlage. Bei zwei getrennten Relais laesst sich
 * aus den Schaltzustaenden nur ablesen, ob gefahren wird: dort heisst Stillstand
 * `idle`, ohne Aussage darueber, ob offen oder geschlossen.
 */
export type CoverMotion =
  | "opening"
  | "closing"
  | "open"
  | "closed"
  | "idle"
  | "conflict"
  | "unknown";

/**
 * Leitet die Fahrtrichtung aus den beiden Relaiszustaenden ab. `conflict` heisst:
 * beide Relais melden "ein" – das darf nicht vorkommen und wird in der UI als
 * Warnung angezeigt.
 */
export function coverMotion(upOn: boolean | null, downOn: boolean | null): CoverMotion {
  if (upOn == null || downOn == null) return "unknown";
  if (upOn && downOn) return "conflict";
  if (upOn) return "opening";
  if (downOn) return "closing";
  return "idle";
}

/**
 * Fahrtrichtung aus dem Zustand, den ein Shelly im Cover-Profil selbst meldet.
 * `conflict` kann hier nicht auftreten: In diesem Profil verriegelt die
 * Geraete-Firmware die beiden Richtungen gegeneinander.
 */
export function coverMotionFromState(state: string | null): CoverMotion {
  switch (state) {
    case "opening": return "opening";
    case "closing": return "closing";
    case "open": return "open";
    case "closed": return "closed";
    case "stopped": return "idle";
    // "calibrating" und alles Unbekannte: keine belastbare Aussage.
    default: return "unknown";
  }
}

export const COVER_MOTION_LABELS: Record<CoverMotion, string> = {
  opening: "Fährt auf",
  closing: "Fährt zu",
  open: "Offen",
  closed: "Geschlossen",
  idle: "Steht",
  conflict: "Beide Richtungen aktiv",
  unknown: "Unbekannt",
};

/**
 * Liegt eine Fahrt an? `null`, wenn der Zustand unbekannt ist. `conflict` zaehlt
 * als aktiv – da liegt Spannung an, auch wenn der Antrieb sich nicht bewegt.
 */
export function coverIsMoving(motion: CoverMotion): boolean | null {
  if (motion === "unknown") return null;
  return motion === "opening" || motion === "closing" || motion === "conflict";
}

/** Eine Markise faehrt aus und ein, sie oeffnet und schliesst nicht. */
const COVER_MOTION_LABELS_MARKISE: Partial<Record<CoverMotion, string>> = {
  opening: "Fährt aus",
  closing: "Fährt ein",
  open: "Ausgefahren",
  closed: "Eingefahren",
};

export function coverMotionLabel(
  motion: CoverMotion,
  category: string | null | undefined,
): string {
  if (category === "MARKISE") {
    return COVER_MOTION_LABELS_MARKISE[motion] ?? COVER_MOTION_LABELS[motion];
  }
  return COVER_MOTION_LABELS[motion];
}

export interface CoverColumns {
  coverUpChannel: number | null;
  coverDownChannel: number | null;
  coverRuntimeSec: number | null;
}

export type CoverParseResult =
  | { ok: true; value: CoverColumns }
  | { ok: false; error: string };

function parseChannel(raw: unknown, fallback: number | null): number | null {
  if (raw === undefined) return fallback;
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > MAX_COVER_CHANNEL) return null;
  return n;
}

/**
 * Kanalzuordnung aus einem Request-Body lesen und pruefen. Fuer Geraete, die
 * kein Antrieb (mehr) sind, werden die Spalten geleert – sonst blieben bei
 * einem Funktionswechsel unpassende Kanaele stehen.
 *
 * Die Pruefung "Auf ≠ Zu" gehoert bewusst auf den Server: Sie ist die einzige
 * Absicherung dagegen, dass beide Fahrtrichtungen auf demselben Relais landen.
 */
export function parseCoverInput(
  body: Record<string, unknown>,
  isCover: boolean,
  current: CoverColumns = { coverUpChannel: null, coverDownChannel: null, coverRuntimeSec: null },
): CoverParseResult {
  if (!isCover) {
    return { ok: true, value: { coverUpChannel: null, coverDownChannel: null, coverRuntimeSec: null } };
  }

  const up = parseChannel(body.coverUpChannel, current.coverUpChannel);
  const down = parseChannel(body.coverDownChannel, current.coverDownChannel);

  if (up == null || down == null) {
    return { ok: false, error: `Bitte je einen Shelly-Kanal (0–${MAX_COVER_CHANNEL}) für Auf und Zu angeben` };
  }
  if (up === down) {
    return { ok: false, error: "Auf und Zu müssen auf unterschiedlichen Kanälen liegen" };
  }

  const rawRuntime = body.coverRuntimeSec;
  const runtime =
    rawRuntime === undefined
      ? (current.coverRuntimeSec ?? DEFAULT_COVER_RUNTIME_SEC)
      : Number(rawRuntime);

  if (!Number.isFinite(runtime) || runtime <= 0 || runtime > MAX_COVER_RUNTIME_SEC) {
    return { ok: false, error: `Die Fahrzeit muss zwischen 1 und ${MAX_COVER_RUNTIME_SEC} Sekunden liegen` };
  }

  return {
    ok: true,
    value: { coverUpChannel: up, coverDownChannel: down, coverRuntimeSec: Math.round(runtime) },
  };
}

/**
 * Beschriftungen je Kategorie – bei einer Markise heisst "auf" ausfahren,
 * bei einem Rolltor oeffnen.
 */
export function coverActionLabels(category: string | null | undefined): {
  open: string;
  close: string;
} {
  if (category === "MARKISE") return { open: "Ausfahren", close: "Einfahren" };
  return { open: "Öffnen", close: "Schließen" };
}
