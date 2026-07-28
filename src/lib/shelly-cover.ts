/**
 * Antriebe mit zwei Fahrtrichtungen (Markise, Rolltor/Rollladen), die ueber
 * zwei getrennte Shelly-Relais laufen – ein Kanal fuer "Auf", einer fuer "Zu".
 *
 * Sicherheitsregel: Beide Kanaele duerfen NIE gleichzeitig anziehen. Bei den
 * meisten Antrieben liegt dann Spannung auf beiden Wicklungsrichtungen; der
 * Motor arbeitet gegen sich selbst oder die Endschalter werden ueberbrueckt.
 * Deshalb schaltet jede Fahrt zuerst die Gegenrichtung ab, wartet eine
 * Umschaltpause und zieht erst dann das Zielrelais an. Schlaegt das Abschalten
 * fehl, wird gar nicht erst eingeschaltet.
 *
 * Reine Auswertung (Kategorien, Kanalpruefung, Fahrtrichtung) liegt in
 * `src/lib/cover-constants.ts`, damit die UI sie ohne Netzwerkcode nutzen kann.
 */

import { shellyBaseId } from "./shelly-cloud";
import { shellySetRelay, type ShellyCloudCreds } from "./shelly-relay";
import { coverChannels, type CoverAction, type CoverDeviceConfig } from "./cover-constants";

export {
  COVER_CATEGORIES,
  COVER_MOTION_LABELS,
  DEFAULT_COVER_RUNTIME_SEC,
  MAX_COVER_RUNTIME_SEC,
  coverChannels,
  coverMotion,
  isCoverCategory,
  isCoverDevice,
  type CoverAction,
  type CoverMotion,
} from "./cover-constants";

/**
 * Wartezeit zwischen Abschalten der Gegenrichtung und Einschalten der
 * Zielrichtung. Gibt dem Relais Zeit zum Abfallen, bevor das zweite anzieht.
 */
const INTERLOCK_MS = 500;

export interface CoverDevice extends CoverDeviceConfig {
  type: string;
  category: string | null;
  ipAddress: string | null;
  shellyId: string | null;
}

export interface CoverResult {
  ok: boolean;
  error?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fuehrt Auf/Stopp/Zu aus. `stop` schaltet beide Kanaele ab und gilt nur als
 * erfolgreich, wenn wirklich beide abgeschaltet wurden – ein haengendes Relais
 * darf nicht als "gestoppt" gemeldet werden.
 */
export async function runCoverAction(
  device: CoverDevice,
  cloud: ShellyCloudCreds | null,
  action: CoverAction,
): Promise<CoverResult> {
  const channels = coverChannels(device);
  if (!channels) {
    return {
      ok: false,
      error: "Antrieb ist nicht eingerichtet – für Auf und Zu müssen zwei verschiedene Shelly-Kanäle hinterlegt sein",
    };
  }

  const target = { ipAddress: device.ipAddress, baseId: shellyBaseId(device.shellyId) };
  if (!target.ipAddress && !(cloud && target.baseId)) {
    return { ok: false, error: "Weder lokale IP noch Shelly-Cloud-Verbindung hinterlegt" };
  }

  if (action === "stop") {
    const [upOff, downOff] = await Promise.all([
      shellySetRelay(target, cloud, channels.up, false),
      shellySetRelay(target, cloud, channels.down, false),
    ]);
    if (upOff && downOff) return { ok: true };
    return { ok: false, error: "Antrieb nicht erreichbar – Fahrt konnte nicht gestoppt werden" };
  }

  const moveChannel = action === "open" ? channels.up : channels.down;
  const idleChannel = action === "open" ? channels.down : channels.up;

  // Verriegelung: Gegenrichtung zwingend zuerst abschalten.
  const released = await shellySetRelay(target, cloud, idleChannel, false);
  if (!released) {
    return {
      ok: false,
      error:
        "Gegenrichtung ließ sich nicht abschalten – Fahrt wurde aus Sicherheitsgründen nicht gestartet",
    };
  }

  await sleep(INTERLOCK_MS);

  const started = await shellySetRelay(target, cloud, moveChannel, true, channels.runtimeSec);
  if (!started) return { ok: false, error: "Antrieb nicht erreichbar" };
  return { ok: true };
}
