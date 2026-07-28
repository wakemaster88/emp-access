import { nukiAction, NUKI_ACTION } from "./nuki";
import { loqedSetBoltState } from "./loqed";
import type { LoqedBoltState } from "./loqed-constants";
import { gardenaControlValve, gardenaStatusMap } from "./gardena";
import { logIrrigationRun } from "./irrigation-run-log";
import { shellySetRelay } from "./shelly-relay";
import { shellyBaseId, shellySwitchIndex } from "./shelly-cloud";
import { isCoverDevice, runCoverAction, type CoverAction } from "./shelly-cover";

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

/**
 * Zusaetzliche Aktionen fuer Antriebe (MARKISE/ROLLTOR). Sie werden nur fuer
 * diese Geraete akzeptiert; bei allen anderen Typen fehlt die Fahrtrichtung.
 */
const COVER_TASK_MAP = {
  close: 3,
  stop: 0,
} as const;

export type DeviceAction = TaskAction | keyof typeof COVER_TASK_MAP;

const ALL_TASK_MAP: Record<DeviceAction, number> = { ...TASK_MAP, ...COVER_TASK_MAP };

/** Aktionen, die ein Antrieb versteht. */
const COVER_ALLOWED: Record<string, CoverAction> = {
  open: "open",
  close: "close",
  stop: "stop",
  // "Zurueck in den Ruhezustand" bedeutet bei einem Antrieb: Fahrt beenden.
  deactivate: "stop",
  reset: "stop",
};

export function isValidDeviceAction(action: string): action is DeviceAction {
  return action in ALL_TASK_MAP;
}

/**
 * Geraete, denen EMP den Befehl selbst zuschickt.
 *
 * Nur bei ihnen sagt das `sent` aus `triggerDeviceAction` etwas aus: Kam der
 * Befehl an oder nicht? Ein Raspberry Pi holt sich seinen Auftrag dagegen
 * selbst ab – dort ist `sent` immer falsch, ohne dass etwas schiefgelaufen ist.
 */
export function deviceSendsRemoteCommand(type: string): boolean {
  return (
    type === "SHELLY" ||
    type === "NUKI_SMARTLOCK" ||
    type === "LOQED_SMARTLOCK" ||
    type === "GARDENA_VALVE"
  );
}

/**
 * Prueft, ob eine Aktion fuer dieses Geraet zulaessig ist. `close`/`stop` gibt
 * es nur bei Antrieben, `emergency` (NOT-AUF) ergibt bei einem Antrieb keinen
 * eindeutigen Sinn – bei einer Markise waere Ausfahren im Sturm sogar falsch.
 */
export function isActionAllowedForDevice(
  action: DeviceAction,
  device: { type: string; category: string | null },
): boolean {
  if (isCoverDevice(device)) return action in COVER_ALLOWED;
  return action in TASK_MAP;
}

interface DeviceForAction {
  id: number;
  type: string;
  /// Steuert bei Shelly-Geraeten, ob als Schalter oder als Antrieb (MARKISE/
  /// ROLLTOR) geschaltet wird.
  category?: string | null;
  shellyId: string | null;
  ipAddress: string | null;
  /// Kanalzuordnung eines Antriebs – siehe `src/lib/shelly-cover.ts`.
  coverUpChannel?: number | null;
  coverDownChannel?: number | null;
  coverRuntimeSec?: number | null;
  nukiSmartlockId?: string | null;
  /// Kennung des Schlosses in der LOQED Integrations-API.
  loqedLockId?: string | null;
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
        | { accountId: number; provider: "SHELLY" | "NUKI" | "GARDENA" | "LOQED" }
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
  action: DeviceAction,
  options: TriggerOptions = {},
): Promise<{ task: number; sent: boolean; error?: string }> {
  const task = ALL_TASK_MAP[action];
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

  if (device.type === "LOQED_SMARTLOCK") {
    if (!device.loqedLockId) {
      return {
        task,
        sent: false,
        error: "Für dieses Schloss ist keine LOQED-Kennung hinterlegt – bitte unter Einstellungen → LOQED abgleichen.",
      };
    }
    const config = await db.apiConfig.findFirst({ where: { accountId, provider: "LOQED" } });
    if (!config?.token) {
      return {
        task,
        sent: false,
        error: "LOQED ist nicht eingerichtet – bitte unter Einstellungen den Zugriffstoken eintragen.",
      };
    }

    // open/emergency => Riegel ganz zurueck, die Tuer geht auf.
    // reset          => Tagverriegelung: zu, aber von innen per Klinke zu oeffnen.
    // deactivate     => abschliessen.
    const state: LoqedBoltState =
      action === "open" || action === "emergency"
        ? "open"
        : action === "reset"
          ? "day_lock"
          : "night_lock";
    const res = await loqedSetBoltState(config.token, device.loqedLockId, state);
    return { task, sent: res.ok, ...(res.error ? { error: res.error } : {}) };
  }

  if (device.type !== "SHELLY") return { task, sent: false };

  const loadCloud = async () => {
    const config = await db.apiConfig.findFirst({
      where: { accountId, provider: "SHELLY" },
    });
    return config?.token && config?.baseUrl
      ? { token: config.token, baseUrl: config.baseUrl }
      : null;
  };

  // Antrieb mit zwei Fahrtrichtungen (Markise, Rolltor). Braucht die Cloud-
  // Zugangsdaten vorab, weil eine Fahrt aus mehreren Schaltbefehlen besteht.
  if (isCoverDevice({ type: device.type, category: device.category ?? null })) {
    const coverAction = COVER_ALLOWED[action];
    if (!coverAction) {
      return { task, sent: false, error: "Aktion ist für einen Antrieb nicht vorgesehen" };
    }
    const res = await runCoverAction(
      {
        type: device.type,
        category: device.category ?? null,
        ipAddress: device.ipAddress,
        shellyId: device.shellyId,
        coverUpChannel: device.coverUpChannel ?? null,
        coverDownChannel: device.coverDownChannel ?? null,
        coverRuntimeSec: device.coverRuntimeSec ?? null,
      },
      await loadCloud(),
      coverAction,
    );
    return { task, sent: res.ok, error: res.error };
  }

  const turnOn = action === "open" || action === "emergency";
  const timerSec = action === "open" ? 3 : undefined;
  const switchIdx = shellySwitchIndex(device.shellyId);
  const baseId = shellyBaseId(device.shellyId);

  // Lokal zuerst; die Cloud-Verbindung wird nur bei Bedarf nachgeladen, damit
  // ein Zutritt im LAN ohne zusaetzliche DB-Abfrage auskommt.
  let sent = false;
  if (device.ipAddress) {
    sent = await shellySetRelay(
      { ipAddress: device.ipAddress, baseId: null },
      null,
      switchIdx,
      turnOn,
      timerSec,
    );
  }
  if (!sent && baseId) {
    sent = await shellySetRelay(
      { ipAddress: null, baseId },
      await loadCloud(),
      switchIdx,
      turnOn,
      timerSec,
    );
  }

  return { task, sent };
}

export const DEVICE_TASK_MAP = TASK_MAP;
