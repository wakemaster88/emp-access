/**
 * Lokale Ausführung nach Kennzeichen-Match: DoorBird und Shelly im LAN,
 * ohne Cloud-Roundtrip. Die Cloud speichert danach nur Historie/Push.
 * Geöffnet wird nur die dem Fahrzeug zugewiesene DoorBird
 * (vehicle-actuate-rules.ts, Rückschalter HUB_DOORBIRD_FALLBACK).
 */
import { ChangeLog } from "./change-log.js";
import { log } from "./config.js";
import { listDoorbirdIds, openDoorbirdDoor } from "./doorbird.js";
import { improveCount } from "./improve-log.js";
import {
  findAllowedVehicle,
  markVehicleTriggered,
  plateActuationAllowed,
  plateActuationMinConf,
  vehicleLocalActuatorsEnabled,
  whitelistMayActuate,
  type CachedVehicle,
} from "./plate.js";
import { cooldownActive, doorbirdFallback, lacksActuator, resolveDoorbirdId } from "./vehicle-actuate-rules.js";
import { TRIGGERED_MAX_AHEAD_MS } from "./whitelist-rules.js";

export { resolveDoorbirdId };

/** HUB_DOORBIRD_FALLBACK=1: ohne Zuweisung die einzige DoorBird (früheres Verhalten). */
const DOORBIRD_FALLBACK = doorbirdFallback(process.env.HUB_DOORBIRD_FALLBACK);
/** Hinweise je Fahrzeug höchstens stündlich. */
const doorbirdLog = new ChangeLog(60 * 60_000);

export interface LocalActuation {
  vehicle: CachedVehicle;
  /** Cloud soll keinen zweiten DOORBIRD_OPEN/Shelly-Cloud-Call anlegen. */
  skipCloud: boolean;
  doorOpened: boolean;
  shellyTriggered: boolean;
  shellyOk: boolean | null;
}

async function switchShellyLocal(
  ip: string,
  action: string,
  timerSeconds: number | null
): Promise<boolean> {
  const turn = ["on", "off", "toggle"].includes(action.toLowerCase())
    ? action.toLowerCase()
    : "on";
  const params = new URLSearchParams({ turn });
  if (timerSeconds && turn !== "toggle") params.set("timer", String(timerSeconds));
  try {
    const res = await fetch(`http://${ip}/relay/0?${params}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) return true;
  } catch {
    // Gen2 RPC als Fallback
  }
  try {
    const url =
      turn === "toggle"
        ? `http://${ip}/rpc/Switch.Toggle?id=0`
        : `http://${ip}/rpc/Switch.Set?id=0&on=${turn === "on"}${
            timerSeconds ? `&toggle_after=${timerSeconds}` : ""
          }`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Schaltet Tor/Shelly fuer ein freigegebenes Kennzeichen.
 *
 * `exact`/`confidence` beschreiben die Lesung (PlateScore.matchKind und
 * .matchConfidence). Geschaltet wird nur bei exaktem Whitelist-Treffer – nie
 * auf einen unscharfen. Hat die Lesung eine Confidence, muss sie mindestens
 * HUB_ALPR_ACTUATE_MIN_CONF erreichen; ohne Messwert (Kamera-eigene
 * Erkennung) zaehlt der exakte Treffer. Ist der Treffer zu unsicher, meldet
 * das Ergebnis `skipCloud`, damit auch die Cloud nicht ersatzweise einen
 * Tueroeffner-Task anlegt.
 *
 * Ist die Fahrzeugliste aelter als HUB_WHITELIST_MAX_AGE_H (Standard 7 Tage
 * ohne gelungenen Abruf), schaltet kein Kennzeichen, ebenfalls mit
 * `skipCloud`; plate.ts loggt das beim Eintritt und dann alle 30 min.
 */
export async function actuateIfAllowed(opts: {
  cameraId: number;
  plate: string;
  exact: boolean;
  /** null = kein Messwert (Kamera-eigene Erkennung, Roh-Text). */
  confidence: number | null;
}): Promise<LocalActuation | null> {
  const vehicle = findAllowedVehicle(opts.plate);
  if (!vehicle) return null;
  if (!plateActuationAllowed(opts.exact, opts.confidence)) {
    log(
      `Fahrzeug ${vehicle.name}: Treffer zu unsicher (${opts.exact ? "exakt" : "nicht exakt"}, conf ${opts.confidence == null ? "unbekannt" : opts.confidence.toFixed(2)}, noetig ≥ ${plateActuationMinConf()}) – keine Schaltung`
    );
    return {
      vehicle,
      skipCloud: true,
      doorOpened: false,
      shellyTriggered: false,
      shellyOk: null,
    };
  }
  if (!whitelistMayActuate()) {
    improveCount("alpr", "whitelist_stale");
    return {
      vehicle,
      skipCloud: true,
      doorOpened: false,
      shellyTriggered: false,
      shellyOk: null,
    };
  }
  if (!vehicleLocalActuatorsEnabled()) return null;

  if (vehicle.cameraId != null && vehicle.cameraId !== opts.cameraId) {
    log(
      `Fahrzeug ${vehicle.name}: Kamera ${opts.cameraId} nicht erlaubt (Filter ${vehicle.cameraId})`
    );
    return null;
  }

  const doorId = resolveDoorbirdId(vehicle, listDoorbirdIds(), DOORBIRD_FALLBACK);
  const canAct = doorId != null || !!vehicle.shellyIp;
  if (doorId != null && !vehicle.doorbirdCameraId) {
    improveCount("alpr", "doorbird_fallback");
    if (doorbirdLog.shouldLog(`fallback:${vehicle.id}`, "", Date.now())) {
      log(`Fahrzeug ${vehicle.name}: ${opts.plate} ohne zugewiesene DoorBird – Ziel ist die einzige DoorBird ${doorId} (HUB_DOORBIRD_FALLBACK)`);
    }
  }
  if (!canAct) {
    // Ein Shelly ohne IP-Adresse fehlt nicht: Ihn schaltet die Cloud.
    if (lacksActuator(vehicle, doorId)) {
      improveCount("alpr", "no_actuator");
      if (doorbirdLog.shouldLog(`none:${vehicle.id}`, "", Date.now())) {
        log(
          `Fahrzeug ${vehicle.name}: ${opts.plate} auf der Liste, ohne zugewiesene DoorBird und ohne Shelly – keine lokale Schaltung (DoorBird in der Fahrzeugverwaltung zuweisen)`
        );
      }
    }
    // Alte Cloud-API ohne Aktoren: Cloud darf den Hub-Task noch anlegen
    // (sie legt ihn nur für eine dem Fahrzeug zugewiesene DoorBird an) und
    // schaltet einen Shelly ohne IP-Adresse über die Shelly-Cloud.
    return {
      vehicle,
      skipCloud: false,
      doorOpened: false,
      shellyTriggered: false,
      shellyOk: null,
    };
  }

  const cooldownMs = Math.max(1, vehicle.cooldownMinutes) * 60_000;
  if (cooldownActive(vehicle.lastTriggeredAt, Date.now(), cooldownMs, TRIGGERED_MAX_AHEAD_MS)) {
    log(`Fahrzeug ${vehicle.name}: Cooldown, keine lokale Schaltung`);
    return {
      vehicle,
      skipCloud: true,
      doorOpened: false,
      shellyTriggered: false,
      shellyOk: null,
    };
  }

  let doorOpened = false;
  let shellyTriggered = false;
  let shellyOk: boolean | null = null;

  if (doorId != null) {
    const r = await openDoorbirdDoor(doorId);
    doorOpened = r.ok;
    if (!r.ok) {
      log(`Fahrzeug ${vehicle.name}: DoorBird fehlgeschlagen: ${r.error ?? "?"}`);
    }
  }

  if (vehicle.shellyIp) {
    shellyTriggered = true;
    shellyOk = await switchShellyLocal(
      vehicle.shellyIp,
      vehicle.shellyAction,
      vehicle.timerSeconds
    );
    log(
      `Fahrzeug ${vehicle.name}: Shelly ${vehicle.shellyIp} ${
        shellyOk ? "OK" : "fehlgeschlagen"
      }`
    );
  }

  if (doorOpened || shellyOk) {
    markVehicleTriggered(vehicle.id);
  }

  const acted = doorOpened || !!shellyOk;
  return {
    vehicle,
    // Bei Fehlschlag Cloud-Task als zweiter Versuch; sonst nicht doppelt öffnen.
    skipCloud: acted,
    doorOpened,
    shellyTriggered,
    shellyOk,
  };
}
