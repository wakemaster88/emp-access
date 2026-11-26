/**
 * Fahrt eines Antriebs (Rolltor) im Notbetrieb der Regeln: Profil aus dem
 * Geraetestatus und Verriegelung der Fahrtrichtungen, wie die Cloud sie
 * faehrt (src/lib/cover-constants.ts, `coverDrivePlan`, und
 * src/lib/shelly-cloud.ts, `shellyCoverComponentId`). Der Hub bindet src/lib
 * nicht ein; beide Seiten pruefen deshalb dieselben Testfaelle
 * (cover-interlock-cases.ts). Reine Logik, ohne Netz.
 */
import type { InterlockAction, InterlockPlan } from "./cover-interlock-cases.js";

export type CoverDrivePlan = InterlockPlan;

/** Umschaltpause zwischen Abschalten der Gegenrichtung und Einschalten der Zielrichtung. */
export const COVER_INTERLOCK_MS = 500;
const DEFAULT_COVER_RUNTIME_SEC = 60;
const MAX_COVER_RUNTIME_SEC = 600;

export const COVER_NOT_CONFIGURED =
  "Antrieb ist nicht eingerichtet – für Auf und Zu müssen zwei verschiedene Shelly-Kanäle hinterlegt sein";

export interface CoverConfig {
  coverUpChannel: number | null;
  coverDownChannel: number | null;
  coverRuntimeSec: number | null;
}

/**
 * Antrieb im Cover-Profil laut Status: kleinster `cover:N` (Gen2), sonst 0
 * bei einem Gen1-Status mit `rollers`; null = zwei Relais (Switch-Profil).
 */
export function coverComponentId(status: Record<string, unknown>): number | null {
  let lowest: number | null = null;
  for (const key of Object.keys(status)) {
    if (!key.startsWith("cover:")) continue;
    const id = Number(key.slice("cover:".length));
    if (Number.isInteger(id) && (lowest === null || id < lowest)) lowest = id;
  }
  if (lowest !== null) return lowest;
  const rollers = status.rollers;
  return Array.isArray(rollers) && rollers.length > 0 ? 0 : null;
}

/** Kanaele und Fahrzeit; null, wenn sich die Verriegelung nicht einhalten liesse. */
function coverChannels(d: CoverConfig): { up: number; down: number; runtimeSec: number } | null {
  const up = d.coverUpChannel;
  const down = d.coverDownChannel;
  if (up == null || down == null) return null;
  if (!Number.isInteger(up) || !Number.isInteger(down) || up < 0 || down < 0 || up === down) return null;
  const configured = d.coverRuntimeSec;
  const runtimeSec =
    configured != null && configured > 0 && configured <= MAX_COVER_RUNTIME_SEC ? configured : DEFAULT_COVER_RUNTIME_SEC;
  return { up, down, runtimeSec };
}

/**
 * Wie die Fahrt auszufuehren ist. Zwei Relais: erst die Gegenrichtung ab,
 * nur wenn das gelang die Umschaltpause, dann die Zielrichtung mit Fahrzeit.
 */
export function coverDrivePlan(coverId: number | null, device: CoverConfig, action: InterlockAction): CoverDrivePlan {
  if (coverId !== null) return { kind: "cover", coverId, action };
  const channels = coverChannels(device);
  if (!channels) return { kind: "refuse", error: COVER_NOT_CONFIGURED };
  if (action === "stop") return { kind: "relays-stop", channels: [channels.up, channels.down] };
  const move = action === "open" ? channels.up : channels.down;
  const release = action === "open" ? channels.down : channels.up;
  return { kind: "relays", release, move, runtimeSec: channels.runtimeSec, pauseMs: COVER_INTERLOCK_MS };
}
