import { nukiAction, NUKI_ACTION } from "./nuki";
import { gardenaControlValve, gardenaStatusMap } from "./gardena";
import { logIrrigationRun } from "./irrigation-run-log";

// Standard-Bewässerungsdauer (Sekunden), falls beim Öffnen keine Dauer
// mitgegeben wird (z. B. Auslösung über den Public-Checkin-Monitor).
const GARDENA_DEFAULT_SECONDS = 1800;

// Task codes für Raspberry Pi:
// 0 = idle, 1 = open once, 2 = emergency open (NOT-AUF), 3 = deactivate
type TaskAction = "open" | "emergency" | "deactivate" | "reset";

const TASK_MAP: Record<TaskAction, number> = {
  open: 1,
  emergency: 2,
  deactivate: 3,
  reset: 0,
};

// Shelly Cloud verwendet 1-basierte Channel-Suffixe (_1 = switch 0).
// Auf 0-basierten Switch-Index mappen.
function toSwitchIndex(shellyId: string | null): number {
  if (!shellyId?.includes("_")) return 0;
  const suffix = Number(shellyId.split("_").pop());
  return isNaN(suffix) || suffix === 0 ? 0 : suffix - 1;
}

async function shellySendLocal(
  ip: string,
  switchIdx: number,
  turnOn: boolean,
  timerSec?: number,
): Promise<boolean> {
  const onStr = turnOn ? "true" : "false";
  const turnStr = turnOn ? "on" : "off";

  // Gen2: POST /rpc/Switch.Set
  try {
    const body: Record<string, unknown> = { id: switchIdx, on: turnOn };
    if (timerSec) body.toggle_after = timerSec;
    const res = await fetch(`http://${ip}/rpc/Switch.Set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return true;
  } catch { /* try Gen2 GET */ }

  // Gen2 GET fallback
  try {
    const params = new URLSearchParams({ id: String(switchIdx), on: onStr });
    if (timerSec) params.set("toggle_after", String(timerSec));
    const res = await fetch(`http://${ip}/rpc/Switch.Set?${params}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return true;
  } catch { /* try Gen1 */ }

  // Gen1: /relay/{idx}?turn=on/off
  try {
    let url = `http://${ip}/relay/${switchIdx}?turn=${turnStr}`;
    if (timerSec) url += `&timer=${timerSec}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (res.ok) return true;
  } catch { /* unavailable */ }

  return false;
}

async function shellySendCloud(
  baseUrl: string,
  authKey: string,
  shellyBaseId: string,
  switchIdx: number,
  turnOn: boolean,
): Promise<boolean> {
  try {
    const body = new URLSearchParams({
      auth_key: authKey.trim(),
      id: shellyBaseId,
      channel: String(switchIdx),
      turn: turnOn ? "on" : "off",
    });
    const res = await fetch(`${baseUrl}/device/relay/control`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json() as { isok?: boolean };
      return data.isok === true;
    }
  } catch { /* unavailable */ }
  return false;
}

interface DeviceForAction {
  id: number;
  type: string;
  shellyId: string | null;
  ipAddress: string | null;
  nukiSmartlockId?: string | null;
  gardenaServiceId?: string | null;
  /// GARDENA-Verbindung (ApiConfig-ID) fuer dieses Geraet – waehlt bei mehreren
  /// GARDENA-Konten die richtigen Zugangsdaten.
  gardenaConfigId?: number | null;
  /// Optionale Pumpe (Device-ID), die beim Aktivieren dieses Ventils mitgeschaltet
  /// wird.
  pumpDeviceId?: number | null;
  flowLph?: number | null;
}

/** Optionale Parameter fuer einzelne Aktionen (z. B. GARDENA-Bewässerungsdauer). */
interface TriggerOptions {
  /// Laufzeit in Sekunden fuer GARDENA "open" (Bewässern). Default 30 min.
  seconds?: number;
}

/**
 * Strukturelle Mindest-Schnittstelle für den verwendeten Prisma-Client.
 * Erlaubt es, sowohl den nackten als auch den um Erweiterungen ergaenzten
 * Client (`getSessionWithDb`) zu uebergeben, ohne TypeScript-Konflikte.
 */
interface DbLike {
  device: {
    update: (args: { where: { id: number }; data: { task: number } }) => Promise<unknown>;
    findFirst: (args: {
      where: { id: number; accountId: number };
      select?: { gardenaServiceId?: boolean; gardenaConfigId?: boolean; type?: boolean };
    }) => Promise<{ gardenaServiceId: string | null; gardenaConfigId: number | null; type: string } | null>;
    findMany: (args: {
      where: { accountId: number; pumpDeviceId: number; type?: "GARDENA_VALVE"; isActive?: boolean; NOT?: { id: number } };
      select?: { gardenaServiceId?: boolean };
    }) => Promise<Array<{ gardenaServiceId: string | null }>>;
  };
  apiConfig: {
    findFirst: (args: {
      where:
        | { accountId: number; provider: "SHELLY" | "NUKI" | "GARDENA" }
        | { id: number; accountId: number };
    }) => Promise<{ token: string | null; baseUrl: string | null; extraConfig: string | null } | null>;
  };
}

/** GARDENA-Zugangsdaten fuer ein Geraet (dessen Verbindung, sonst erste des Accounts). */
async function gardenaCreds(
  db: DbLike,
  accountId: number,
  configId: number | null,
): Promise<{ key: string; secret: string } | null> {
  const config = configId
    ? await db.apiConfig.findFirst({ where: { id: configId, accountId } })
    : await db.apiConfig.findFirst({ where: { accountId, provider: "GARDENA" } });
  if (!config?.token || !config?.extraConfig) return null;
  return { key: config.token, secret: config.extraConfig };
}

/**
 * Schaltet die einem Ventil zugeordnete Pumpe mit:
 *  - start=true  → Pumpe fuer die gleiche Laufzeit oeffnen (GARDENA stoppt danach
 *    automatisch; erneutes Oeffnen durch weitere Ventile verlaengert).
 *  - start=false → Pumpe nur schliessen, wenn kein weiteres Ventil an derselben
 *    Pumpe noch laeuft (Schutz vor Trockenlauf gegen geschlossene Ventile).
 * Best effort – Fehler blockieren die Ventil-Aktion nicht.
 */
async function syncPumpForValve(
  db: DbLike,
  accountId: number,
  valveId: number,
  pumpDeviceId: number,
  start: boolean,
  seconds: number,
): Promise<void> {
  const pump = await db.device.findFirst({
    where: { id: pumpDeviceId, accountId },
    select: { gardenaServiceId: true, gardenaConfigId: true, type: true },
  });
  if (!pump?.gardenaServiceId || pump.type !== "GARDENA_VALVE") return;

  const creds = await gardenaCreds(db, accountId, pump.gardenaConfigId ?? null);
  if (!creds) return;

  if (start) {
    await gardenaControlValve(creds.key, creds.secret, pump.gardenaServiceId, "open", seconds);
    return;
  }

  const siblings = await db.device.findMany({
    where: { accountId, pumpDeviceId, type: "GARDENA_VALVE", isActive: true, NOT: { id: valveId } },
    select: { gardenaServiceId: true },
  });
  const siblingServiceIds = siblings
    .map((s) => s.gardenaServiceId)
    .filter((sid): sid is string => !!sid);

  if (siblingServiceIds.length > 0) {
    const statusMap = await gardenaStatusMap(creds.key, creds.secret);
    for (const sid of siblingServiceIds) {
      if (statusMap.get(sid)?.watering) return; // ein Geschwister-Ventil laeuft noch
    }
  }

  await gardenaControlValve(creds.key, creds.secret, pump.gardenaServiceId, "close");
}

/**
 * Setzt den Task auf dem Gerät und – bei Shelly – sendet den Switch-Befehl
 * lokal (Gen2/Gen1) bzw. via Shelly Cloud. Wird sowohl vom internen Action-
 * Endpoint als auch vom Public-Checkin-Monitor genutzt.
 */
export async function triggerDeviceAction(
  db: DbLike,
  device: DeviceForAction,
  accountId: number,
  action: TaskAction,
  options: TriggerOptions = {},
): Promise<{ task: number; sent: boolean }> {
  const task = TASK_MAP[action];
  await db.device.update({
    where: { id: device.id },
    data: { task },
  });

  if (device.type === "GARDENA_VALVE") {
    if (!device.gardenaServiceId) return { task, sent: false };
    // Zugangsdaten der zugeordneten GARDENA-Verbindung; Fallback auf die erste
    // GARDENA-Verbindung des Accounts (Alt-Geraete ohne gardenaConfigId).
    const creds = await gardenaCreds(db, accountId, device.gardenaConfigId ?? null);
    if (!creds) return { task, sent: false };

    // open/emergency => bewässern (START), deactivate/reset => stoppen (STOP).
    const start = action === "open" || action === "emergency";
    const seconds = options.seconds ?? GARDENA_DEFAULT_SECONDS;
    const res = await gardenaControlValve(
      creds.key,
      creds.secret,
      device.gardenaServiceId,
      start ? "open" : "close",
      seconds,
    );

    // Zugeordnete Pumpe automatisch mitschalten (best effort).
    if (device.pumpDeviceId) {
      try {
        await syncPumpForValve(db, accountId, device.id, device.pumpDeviceId, start, seconds);
      } catch { /* Pumpe optional – Ventil-Aktion nicht blockieren */ }
    }
    if (start && res.ok) {
      await logIrrigationRun({
        accountId,
        deviceId: device.id,
        durationMinutes: Math.round(seconds / 60),
        source: "manual",
        flowLph: device.flowLph ?? null,
      });
    }
    return { task, sent: res.ok };
  }

  if (device.type === "NUKI_SMARTLOCK") {
    if (!device.nukiSmartlockId) return { task, sent: false };
    const config = await db.apiConfig.findFirst({
      where: { accountId, provider: "NUKI" },
    });
    if (!config?.token) return { task, sent: false };

    // open/emergency => unlatch (kurz aufdruecken), deactivate/reset => lock.
    const nukiActionId =
      action === "open" || action === "emergency"
        ? NUKI_ACTION.UNLATCH
        : NUKI_ACTION.LOCK;
    const res = await nukiAction(config.token, device.nukiSmartlockId, nukiActionId);
    return { task, sent: res.ok };
  }

  if (device.type !== "SHELLY") return { task, sent: false };

  const turnOn = action === "open" || action === "emergency";
  const timerSec = action === "open" ? 3 : undefined;
  const switchIdx = toSwitchIndex(device.shellyId);

  let sent = false;

  if (device.ipAddress) {
    sent = await shellySendLocal(device.ipAddress, switchIdx, turnOn, timerSec);
  }

  if (!sent) {
    const shellyBaseId = device.shellyId?.split("_")[0] ?? device.shellyId;
    const config = await db.apiConfig.findFirst({
      where: { accountId, provider: "SHELLY" },
    });
    if (config?.token && config?.baseUrl && shellyBaseId) {
      const cloudBaseUrl = `https://${config.baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
      sent = await shellySendCloud(cloudBaseUrl, config.token, shellyBaseId, switchIdx, turnOn);
    }
  }

  return { task, sent };
}

export const DEVICE_TASK_MAP = TASK_MAP;
