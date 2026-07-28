/**
 * Antriebe mit zwei Fahrtrichtungen (Markise, Rolltor/Rollladen).
 *
 * Solche Antriebe haengen auf zwei Wegen an einem Shelly, und der Unterschied
 * ist nicht eine Frage der Einrichtung in EMP, sondern des Geraeteprofils im
 * Shelly selbst:
 *
 *  - Cover-Profil: Der Shelly fuehrt den Antrieb als Rollladen. Er stellt nur
 *    eine `cover:N`-Komponente bereit, kennt seine Endlagen und verriegelt die
 *    Fahrtrichtungen in der Firmware. Relaisbefehle weist er ab.
 *  - Switch-Profil: Zwei unabhaengige Relais, eines je Fahrtrichtung. Hier muss
 *    die Verriegelung diese Steuerung uebernehmen.
 *
 * Deshalb wird das Profil vor jeder Fahrt aus dem Geraetestatus gelesen statt
 * konfiguriert – ein Abruf beantwortet in einem Schritt beides: welches Profil
 * gilt und ueber welchen Weg (lokal oder Cloud) das Geraet erreichbar ist.
 *
 * Reine Auswertung (Kategorien, Kanalpruefung, Fahrtrichtung) liegt in
 * `src/lib/cover-constants.ts`, damit die UI sie ohne Netzwerkcode nutzen kann.
 */

import {
  shellyBaseId,
  shellyCloudAllStatuses,
  shellyCoverComponentId,
  shellyCoverReading,
  shellyLocalStatusMap,
  shellySwitchState,
  type ShellyDeviceStatusMap,
} from "./shelly-cloud";
import { shellySetRelay, type ShellyCloudCreds } from "./shelly-relay";
import { shellyCoverCommandCloud, shellyCoverCommandLocal } from "./shelly-cover-rpc";
import {
  coverChannels,
  coverMotion,
  coverMotionFromState,
  type CoverAction,
  type CoverDeviceConfig,
  type CoverMotion,
} from "./cover-constants";

export {
  COVER_CATEGORIES,
  COVER_MOTION_LABELS,
  DEFAULT_COVER_RUNTIME_SEC,
  MAX_COVER_RUNTIME_SEC,
  coverChannels,
  coverIsMoving,
  coverMotion,
  coverMotionFromState,
  coverMotionLabel,
  isCoverCategory,
  isCoverDevice,
  type CoverAction,
  type CoverMotion,
} from "./cover-constants";

/**
 * Wartezeit zwischen Abschalten der Gegenrichtung und Einschalten der
 * Zielrichtung. Gibt dem Relais Zeit zum Abfallen, bevor das zweite anzieht.
 * Nur im Switch-Profil relevant; im Cover-Profil verriegelt der Shelly selbst.
 */
const INTERLOCK_MS = 500;

/**
 * Zeitlimit fuer den lokalen Statusabruf vor einer Fahrt.
 *
 * Ein Shelly im selben Netz antwortet in wenigen Millisekunden. Laeuft die App
 * dagegen auf Vercel, ist die hinterlegte 192.168-Adresse dort ueberhaupt nicht
 * erreichbar – dann zaehlt allein, wie schnell dieser Versuch aufgibt und der
 * Cloud-Weg uebernimmt. Mit dem Standardwert vergingen bis zu sechs Sekunden,
 * bevor sich das Tor ueberhaupt bewegte.
 */
const LOCAL_PROBE_TIMEOUT_MS = 1000;

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

export interface CoverReading {
  motion: CoverMotion;
  /**
   * Fahrposition in Prozent (100 = offen). Nur im Cover-Profil und nur bei
   * kalibriertem Antrieb bekannt; an zwei Relais gibt es keine Position.
   */
  position: number | null;
  /// Relaiszustaende – nur im Switch-Profil belegt.
  upOn: boolean | null;
  downOn: boolean | null;
  /**
   * `false` heisst: Der Antrieb laeuft ueber zwei Relais, aber die
   * Kanalzuordnung fehlt. Im Cover-Profil braucht es keine Kanaele, dort ist
   * dieser Wert immer `true`.
   */
  configured: boolean;
  mode: "cover" | "relays";
  power?: number;
}

/**
 * Fahrzustand eines Antriebs aus einem Geraetestatus lesen – im Profil, das der
 * Shelly tatsaechlich fuehrt. Gemeinsame Auswertung fuer Geraetedetail und
 * Geraeteliste, damit die beiden Ansichten nicht auseinanderlaufen.
 */
export function readCoverStatus(
  status: ShellyDeviceStatusMap,
  device: CoverDeviceConfig,
): CoverReading {
  const coverId = shellyCoverComponentId(status);
  if (coverId !== null) {
    const reading = shellyCoverReading(status, coverId);
    return {
      motion: coverMotionFromState(reading.state),
      position: reading.position,
      upOn: null,
      downOn: null,
      configured: true,
      mode: "cover",
      power: reading.power,
    };
  }

  const channels = coverChannels(device);
  if (!channels) {
    return {
      motion: "unknown",
      position: null,
      upOn: null,
      downOn: null,
      configured: false,
      mode: "relays",
    };
  }

  // `strict`: Bei einem Antrieb unterscheidet sich "Auf" von "Zu" nur durch den
  // Kanalindex – ein Ausweichen auf einen anderen Kanal meldete die falsche
  // Fahrtrichtung.
  const up = shellySwitchState(status, channels.up, true);
  const down = shellySwitchState(status, channels.down, true);
  return {
    motion: coverMotion(up.output, down.output),
    position: null,
    upOn: up.output,
    downOn: down.output,
    configured: true,
    mode: "relays",
    power:
      up.power == null && down.power == null ? undefined : (up.power ?? 0) + (down.power ?? 0),
  };
}

/** Wie dieser Antrieb angesprochen werden muss und auf welchem Weg er antwortet. */
type CoverRoute =
  | { mode: "cover"; via: "local"; ip: string; coverId: number }
  | { mode: "cover"; via: "cloud"; cloud: ShellyCloudCreds; baseId: string; coverId: number }
  | { mode: "relays"; via: "local" | "cloud" };

/**
 * Profil und Weg aus dem Geraetestatus bestimmen. `null` heisst: Das Geraet hat
 * weder lokal noch ueber die Cloud geantwortet – dann ist auch jeder Fahrbefehl
 * zwecklos.
 */
async function resolveCoverRoute(
  device: CoverDevice,
  cloud: ShellyCloudCreds | null,
  baseId: string | null,
): Promise<CoverRoute | null> {
  if (device.ipAddress) {
    const status = await shellyLocalStatusMap(device.ipAddress, LOCAL_PROBE_TIMEOUT_MS);
    if (status) {
      const coverId = shellyCoverComponentId(status);
      return coverId === null
        ? { mode: "relays", via: "local" }
        : { mode: "cover", via: "local", ip: device.ipAddress, coverId };
    }
  }

  if (cloud && baseId) {
    // Gecachter Sammelabruf – laeuft nicht in das Ratenlimit der Shelly Cloud.
    const all = await shellyCloudAllStatuses(cloud.baseUrl, cloud.token);
    const entry = all?.get(baseId) ?? all?.get(baseId.toLowerCase());
    if (entry) {
      const coverId = shellyCoverComponentId(entry.status);
      return coverId === null
        ? { mode: "relays", via: "cloud" }
        : { mode: "cover", via: "cloud", cloud, baseId, coverId };
    }
  }

  return null;
}

/**
 * Fahrt an zwei getrennten Relais.
 *
 * Sicherheitsregel: Beide Kanaele duerfen NIE gleichzeitig anziehen. Bei den
 * meisten Antrieben liegt dann Spannung auf beiden Wicklungsrichtungen; der
 * Motor arbeitet gegen sich selbst oder die Endschalter werden ueberbrueckt.
 * Deshalb schaltet jede Fahrt zuerst die Gegenrichtung ab, wartet eine
 * Umschaltpause und zieht erst dann das Zielrelais an. Schlaegt das Abschalten
 * fehl, wird gar nicht erst eingeschaltet.
 */
async function runRelayCoverAction(
  device: CoverDevice,
  cloud: ShellyCloudCreds | null,
  baseId: string | null,
  via: "local" | "cloud",
  action: CoverAction,
): Promise<CoverResult> {
  const channels = coverChannels(device);
  if (!channels) {
    return {
      ok: false,
      error: "Antrieb ist nicht eingerichtet – für Auf und Zu müssen zwei verschiedene Shelly-Kanäle hinterlegt sein",
    };
  }

  // Auf welchem Weg das Geraet antwortet, ist beim Lesen des Status schon
  // festgestellt worden. Antwortete es nur ueber die Cloud, wuerde jeder
  // Schaltbefehl sonst erneut in denselben lokalen Verbindungsversuch laufen –
  // und eine Fahrt besteht aus mehreren Befehlen.
  const target = { ipAddress: via === "local" ? device.ipAddress : null, baseId };

  // `stop` gilt nur als erfolgreich, wenn wirklich beide Kanaele abgeschaltet
  // wurden – ein haengendes Relais darf nicht als "gestoppt" gemeldet werden.
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

/** Fuehrt Auf/Stopp/Zu aus – im Profil, das der Shelly tatsaechlich fährt. */
export async function runCoverAction(
  device: CoverDevice,
  cloud: ShellyCloudCreds | null,
  action: CoverAction,
): Promise<CoverResult> {
  const baseId = shellyBaseId(device.shellyId);
  if (!device.ipAddress && !(cloud && baseId)) {
    return { ok: false, error: "Weder lokale IP noch Shelly-Cloud-Verbindung hinterlegt" };
  }

  const route = await resolveCoverRoute(device, cloud, baseId);
  if (!route) {
    return {
      ok: false,
      error: "Antrieb nicht erreichbar – Status ließ sich weder lokal noch über die Shelly Cloud lesen",
    };
  }

  if (route.mode === "relays") {
    return runRelayCoverAction(device, cloud, baseId, route.via, action);
  }

  const res =
    route.via === "local"
      ? await shellyCoverCommandLocal(route.ip, route.coverId, action)
      : await shellyCoverCommandCloud(route.cloud, route.baseId, route.coverId, action);

  if (res.ok) return { ok: true };
  return { ok: false, error: res.error ?? "Antrieb hat den Fahrbefehl nicht angenommen" };
}
