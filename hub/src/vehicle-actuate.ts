/**
 * Lokale Ausführung nach Kennzeichen-Match: DoorBird und Shelly im LAN,
 * ohne Cloud-Roundtrip. Die Cloud speichert danach nur Historie/Push.
 */
import { log } from "./config.js";
import { listDoorbirdIds, openDoorbirdDoor } from "./doorbird.js";
import {
  findAllowedVehicle,
  markVehicleTriggered,
  vehicleLocalActuatorsEnabled,
  type CachedVehicle,
} from "./plate.js";

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

function resolveDoorbirdId(vehicle: CachedVehicle): number | null {
  if (vehicle.doorbirdCameraId) return vehicle.doorbirdCameraId;
  const ids = listDoorbirdIds();
  return ids.length === 1 ? ids[0] : null;
}

export async function actuateIfAllowed(opts: {
  cameraId: number;
  plate: string;
}): Promise<LocalActuation | null> {
  const vehicle = findAllowedVehicle(opts.plate);
  if (!vehicle) return null;
  if (!vehicleLocalActuatorsEnabled()) return null;

  if (vehicle.cameraId != null && vehicle.cameraId !== opts.cameraId) {
    log(
      `Fahrzeug ${vehicle.name}: Kamera ${opts.cameraId} nicht erlaubt (Filter ${vehicle.cameraId})`
    );
    return null;
  }

  const doorId = resolveDoorbirdId(vehicle);
  const canAct = doorId != null || !!vehicle.shellyIp;
  if (!canAct) {
    // Alte Cloud-API ohne Aktoren: Cloud darf den Hub-Task noch anlegen.
    return {
      vehicle,
      skipCloud: false,
      doorOpened: false,
      shellyTriggered: false,
      shellyOk: null,
    };
  }

  const cooldownMs = Math.max(1, vehicle.cooldownMinutes) * 60_000;
  if (vehicle.lastTriggeredAt && Date.now() - vehicle.lastTriggeredAt < cooldownMs) {
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
