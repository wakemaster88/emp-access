/**
 * Offline-Erkennung fuer Geraete mit Push-Benachrichtigung.
 *
 * Wird alle 5 Minuten vom Cron `/api/cron/device-offline-check` aufgerufen.
 * Erkennt ZUSTANDSUEBERGAENGE (online → offline und zurueck) ueber das Feld
 * `Device.offlineNotifiedAt`:
 *   - Geraet offline + offlineNotifiedAt == NULL → Offline-Push, Feld setzen
 *   - Geraet online  + offlineNotifiedAt != NULL → Online-Push, Feld leeren
 * Dadurch gibt es pro Offline-Episode genau eine Benachrichtigung (kein Spam
 * bei jedem Tick).
 *
 * Online-Ermittlung je Gerätetyp:
 *   RASPBERRY_PI  – Heartbeat: lastUpdate juenger als 5 Minuten
 *   SHELLY        – Shelly-Cloud all_status (lokale IPs sind von Vercel aus
 *                   nicht erreichbar; Geraete ohne Cloud-ID werden uebersprungen)
 *   GARDENA_VALVE – GARDENA-Cloud-Status (rfLink des Geraets)
 *   NUKI          – kein verlaesslicher Online-Indikator → nicht geprueft
 *
 * Ausserdem ohne Opt-in (wichtige Infrastruktur):
 *   Hub           – Heartbeat aelter als 5 Minuten
 *   Kameras       – vom Hub zuletzt erreicht (Camera.lastSeenAt) vor mehr als
 *                   10 Minuten; nur solange der Hub selbst online ist, sonst
 *                   meldet allein der Hub-Ausfall
 *   Soundweb      – DI-Verbindung des Hubs seit mehr als 10 Minuten getrennt
 *
 * Gemeldet wird per Web-Push und Telegram (outage-notify.ts).
 */
import { prisma } from "./prisma";
import {
  accountsWithOutageChannel,
  formatBerlinTime,
  formatSince,
  notifyOutage,
  outageTransitions,
} from "./outage-notify";
import { shellyBaseId, shellyCloudAllStatuses } from "./shelly-cloud";
import { gardenaStatusMap } from "./gardena";

const PI_OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;

interface DeviceRow {
  id: number;
  name: string;
  type: string;
  shellyId: string | null;
  gardenaServiceId: string | null;
  gardenaConfigId: number | null;
  lastUpdate: Date | null;
  offlineNotifiedAt: Date | null;
}

export interface OfflineTickResult {
  accountsChecked: number;
  devicesChecked: number;
  wentOffline: string[];
  cameOnline: string[];
  pushed: number;
}

/** Online-Status eines Geraets ermitteln; null = nicht pruefbar (ueberspringen). */
function resolveOnline(
  device: DeviceRow,
  now: number,
  shellyMap: Map<string, { online: boolean }> | null,
  gardenaMaps: Map<number, Map<string, { online: boolean }>>,
  gardenaFallbackConfigId: number | null,
): boolean | null {
  if (device.type === "RASPBERRY_PI") {
    // Ohne jemals empfangenen Heartbeat gilt das Geraet als "nie online" –
    // dafuer soll kein Offline-Alarm kommen.
    if (!device.lastUpdate) return null;
    return now - device.lastUpdate.getTime() < PI_OFFLINE_THRESHOLD_MS;
  }

  if (device.type === "SHELLY") {
    const baseId = shellyBaseId(device.shellyId);
    if (!baseId || !shellyMap) return null;
    const entry = shellyMap.get(baseId) ?? shellyMap.get(baseId.toLowerCase());
    if (!entry) return null;
    return entry.online;
  }

  if (device.type === "GARDENA_VALVE") {
    if (!device.gardenaServiceId) return null;
    const configId = device.gardenaConfigId ?? gardenaFallbackConfigId;
    if (configId === null) return null;
    const map = gardenaMaps.get(configId);
    if (!map) return null;
    const s = map.get(device.gardenaServiceId);
    if (!s) return null;
    return s.online;
  }

  return null;
}

/** Hub gilt als offline, wenn der Heartbeat (alle 60 s) laenger ausbleibt – wie im Dashboard. */
const HUB_OFFLINE_AFTER_MS = 5 * 60_000;
/** Karteileichen (z. B. alter HUB_NAME) nicht ewig melden. */
const HUB_STALE_AFTER_MS = 7 * 24 * 3_600_000;
/**
 * Kamera/Soundweb erst nach 10 Minuten melden: Der Hub meldet Lebenszeichen
 * etwa minuetlich, ein Neustart oder kurzer Link-Flap bleibt damit still.
 */
export const DEVICE_OUTAGE_GRACE_MS = 10 * 60_000;
const DEVICE_STALE_AFTER_MS = 7 * 24 * 3_600_000;

/**
 * Hub-Agents eines Accounts auf Zustandsuebergaenge pruefen und Push senden.
 * Gleiche Mechanik wie bei den Geraeten: `HubAgent.offlineNotifiedAt` merkt
 * sich, dass der Offline-Push raus ist; kommt der Heartbeat zurueck, gibt es
 * einmal „wieder online“ und das Feld wird geleert.
 */
async function checkHubs(
  accountId: number,
  now: number,
): Promise<{
  wentOffline: string[];
  cameOnline: string[];
  pushed: number;
  /** Mindestens ein Hub meldet sich und keiner hat gerade gewechselt. */
  hubSteady: boolean;
}> {
  const out = { wentOffline: [] as string[], cameOnline: [] as string[], pushed: 0, hubSteady: false };
  const hubs = await prisma.hubAgent.findMany({
    where: { accountId, lastSeenAt: { not: null } },
    select: { id: true, name: true, lastSeenAt: true, offlineNotifiedAt: true },
  });
  const wentOffline = hubs.filter(
    (h) =>
      !h.offlineNotifiedAt &&
      h.lastSeenAt!.getTime() < now - HUB_OFFLINE_AFTER_MS &&
      h.lastSeenAt!.getTime() > now - HUB_STALE_AFTER_MS,
  );
  const cameOnline = hubs.filter(
    (h) => !!h.offlineNotifiedAt && h.lastSeenAt!.getTime() >= now - HUB_OFFLINE_AFTER_MS,
  );
  // Kamera-/Soundweb-Lebenszeichen kommen nur ueber den Hub. Ist er weg oder
  // gerade erst zurueck (noch nicht alle Kameras gepollt), schweigen diese
  // Pruefungen in diesem Tick.
  out.hubSteady =
    cameOnline.length === 0 &&
    hubs.some((h) => !h.offlineNotifiedAt && h.lastSeenAt!.getTime() >= now - HUB_OFFLINE_AFTER_MS);
  if (wentOffline.length === 0 && cameOnline.length === 0) return out;

  // Erst DB-Zustand fortschreiben, dann senden (kein Dauerfeuer bei Push-Fehlern).
  if (wentOffline.length > 0) {
    await prisma.hubAgent.updateMany({
      where: { id: { in: wentOffline.map((h) => h.id) } },
      data: { offlineNotifiedAt: new Date() },
    });
  }
  if (cameOnline.length > 0) {
    await prisma.hubAgent.updateMany({
      where: { id: { in: cameOnline.map((h) => h.id) } },
      data: { offlineNotifiedAt: null },
    });
  }

  for (const h of wentOffline) {
    out.wentOffline.push(`Hub ${h.name}`);
    const push = await notifyOutage(accountId, {
      title: "⚠️ Hub offline",
      body: `${h.name} meldet sich seit ${formatBerlinTime(h.lastSeenAt!)} Uhr nicht mehr. Kameras, Kennzeichen und Türöffner stehen still.`,
      url: "/network",
      tag: `hub-offline-${h.id}`,
    });
    out.pushed += push.pushed + push.telegram;
  }
  for (const h of cameOnline) {
    out.cameOnline.push(`Hub ${h.name}`);
    const push = await notifyOutage(accountId, {
      title: "✅ Hub wieder online",
      body: `${h.name} meldet sich wieder (${formatBerlinTime(h.lastSeenAt!)} Uhr).`,
      url: "/network",
      tag: `hub-online-${h.id}`,
    });
    out.pushed += push.pushed + push.telegram;
  }
  return out;
}

type TickPart = { wentOffline: string[]; cameOnline: string[]; pushed: number };

/**
 * Kameras (Reolink und DoorBird): offline, wenn der Hub sie laenger als
 * 10 Minuten nicht erreicht hat. Eine Meldung pro Episode, Entwarnung beim
 * naechsten Lebenszeichen.
 */
export async function checkCameras(accountId: number, now: number): Promise<TickPart> {
  const out: TickPart = { wentOffline: [], cameOnline: [], pushed: 0 };
  const cams = await prisma.camera.findMany({
    where: { accountId, enabled: true, lastSeenAt: { not: null } },
    select: { id: true, name: true, host: true, kind: true, lastSeenAt: true, offlineNotifiedAt: true },
  });
  const rows = cams.map((c) => ({
    ...c,
    offlineSince: c.lastSeenAt,
    online: now - c.lastSeenAt!.getTime() < DEVICE_OUTAGE_GRACE_MS,
  }));
  const { wentOffline, cameOnline } = outageTransitions(rows, now, DEVICE_OUTAGE_GRACE_MS, DEVICE_STALE_AFTER_MS);
  if (wentOffline.length === 0 && cameOnline.length === 0) return out;

  if (wentOffline.length > 0) {
    await prisma.camera.updateMany({
      where: { id: { in: wentOffline.map((c) => c.id) } },
      data: { offlineNotifiedAt: new Date(now) },
    });
  }
  if (cameOnline.length > 0) {
    await prisma.camera.updateMany({
      where: { id: { in: cameOnline.map((c) => c.id) } },
      data: { offlineNotifiedAt: null },
    });
  }

  const label = (c: (typeof rows)[number]) => (c.kind === "DOORBIRD" ? `DoorBird ${c.name}` : c.name);
  if (wentOffline.length > 0) {
    out.wentOffline.push(...wentOffline.map((c) => `Kamera ${c.name}`));
    const single = wentOffline.length === 1;
    const lines = wentOffline.map((c) => `${label(c)} (${c.host}) ${formatSince(c.lastSeenAt!, new Date(now))}`);
    const res = await notifyOutage(accountId, {
      title: single ? `⚠️ Kamera nicht erreichbar: ${label(wentOffline[0])}` : `⚠️ ${wentOffline.length} Kameras nicht erreichbar`,
      body:
        (single ? `${lines[0]} nicht erreichbar.` : `Nicht erreichbar:\n${lines.join("\n")}`) +
        "\nHäufige Ursachen: Switch-Port/VLAN, PoE oder Kabel. Der Hub läuft.",
      url: "/cameras",
      tag: "camera-offline",
    });
    out.pushed += res.pushed + res.telegram;
  }
  if (cameOnline.length > 0) {
    out.cameOnline.push(...cameOnline.map((c) => `Kamera ${c.name}`));
    const single = cameOnline.length === 1;
    const res = await notifyOutage(accountId, {
      title: single ? `✅ Kamera wieder erreichbar: ${label(cameOnline[0])}` : `✅ ${cameOnline.length} Kameras wieder erreichbar`,
      body: single
        ? `${label(cameOnline[0])} (${cameOnline[0].host}) meldet sich wieder.`
        : `Wieder erreichbar: ${cameOnline.map(label).join(", ")}`,
      url: "/cameras",
      tag: "camera-online",
    });
    out.pushed += res.pushed + res.telegram;
  }
  return out;
}

/** Soundweb-Prozessoren: DI-Verbindung des Hubs seit mehr als 10 Minuten getrennt. */
export async function checkSoundweb(accountId: number, now: number): Promise<TickPart> {
  const out: TickPart = { wentOffline: [], cameOnline: [], pushed: 0 };
  const devices = await prisma.soundwebDevice.findMany({
    where: { accountId, isActive: true, lastSeenAt: { not: null } },
    select: {
      id: true,
      name: true,
      host: true,
      connected: true,
      lastSeenAt: true,
      lastError: true,
      disconnectedAt: true,
      offlineNotifiedAt: true,
    },
  });
  const rows = devices.map((d) => {
    const fresh = now - d.lastSeenAt!.getTime() < DEVICE_OUTAGE_GRACE_MS;
    return {
      ...d,
      online: fresh && d.connected,
      // Getrennt gemeldet → seit disconnectedAt; keine Meldung mehr → seit lastSeenAt.
      offlineSince: fresh ? d.disconnectedAt : d.connected ? d.lastSeenAt : (d.disconnectedAt ?? d.lastSeenAt),
    };
  });
  const { wentOffline, cameOnline } = outageTransitions(rows, now, DEVICE_OUTAGE_GRACE_MS, DEVICE_STALE_AFTER_MS);
  if (wentOffline.length === 0 && cameOnline.length === 0) return out;

  if (wentOffline.length > 0) {
    await prisma.soundwebDevice.updateMany({
      where: { id: { in: wentOffline.map((d) => d.id) } },
      data: { offlineNotifiedAt: new Date(now) },
    });
  }
  if (cameOnline.length > 0) {
    await prisma.soundwebDevice.updateMany({
      where: { id: { in: cameOnline.map((d) => d.id) } },
      data: { offlineNotifiedAt: null },
    });
  }
  for (const d of wentOffline) {
    out.wentOffline.push(`Soundweb ${d.name}`);
    const res = await notifyOutage(accountId, {
      title: `⚠️ Soundweb getrennt: ${d.name}`,
      body: `${d.name} (${d.host}) ${formatSince(d.offlineSince!, new Date(now))} nicht verbunden.${d.lastError ? ` Fehler: ${d.lastError}` : ""}`,
      url: "/audio",
      tag: `soundweb-offline-${d.id}`,
    });
    out.pushed += res.pushed + res.telegram;
  }
  for (const d of cameOnline) {
    out.cameOnline.push(`Soundweb ${d.name}`);
    const res = await notifyOutage(accountId, {
      title: `✅ Soundweb wieder verbunden: ${d.name}`,
      body: `${d.name} (${d.host}) ist wieder verbunden.`,
      url: "/audio",
      tag: `soundweb-online-${d.id}`,
    });
    out.pushed += res.pushed + res.telegram;
  }
  return out;
}

export async function runOfflineCheckTick(): Promise<OfflineTickResult> {
  const now = Date.now();
  const result: OfflineTickResult = {
    accountsChecked: 0,
    devicesChecked: 0,
    wentOffline: [],
    cameOnline: [],
    pushed: 0,
  };

  // Nur Accounts pruefen, die einen Meldeweg haben (Push-Abo oder Telegram).
  const accountIds = await accountsWithOutageChannel();
  if (accountIds.length === 0) return result;

  for (const accountId of accountIds) {
    result.accountsChecked++;

    // Lokale Hubs zuerst: ohne Hub gibt es keine Kameras, Kennzeichen und
    // Tueroeffner – ein stiller Ausfall ueber Nacht soll nicht erst am
    // naechsten Vormittag auffallen.
    let hubSteady = false;
    try {
      const hubResult = await checkHubs(accountId, now);
      result.wentOffline.push(...hubResult.wentOffline);
      result.cameOnline.push(...hubResult.cameOnline);
      result.pushed += hubResult.pushed;
      hubSteady = hubResult.hubSteady;
    } catch (err) {
      console.error("[device-offline] hub check failed:", err);
    }

    // Kameras und Soundweb: Lebenszeichen kommen ueber den Hub.
    if (hubSteady) {
      for (const [name, check] of [
        ["camera", checkCameras],
        ["soundweb", checkSoundweb],
      ] as const) {
        try {
          const part = await check(accountId, now);
          result.wentOffline.push(...part.wentOffline);
          result.cameOnline.push(...part.cameOnline);
          result.pushed += part.pushed;
        } catch (err) {
          console.error(`[device-offline] ${name} check failed:`, err);
        }
      }
    }

    const devices: DeviceRow[] = await prisma.device.findMany({
      where: {
        accountId,
        isActive: true,
        // Opt-in pro Geraet: nur Geraete mit aktivierter Offline-Benachrichtigung.
        offlineAlertsEnabled: true,
        type: { in: ["RASPBERRY_PI", "SHELLY", "GARDENA_VALVE"] },
      },
      select: {
        id: true,
        name: true,
        type: true,
        shellyId: true,
        gardenaServiceId: true,
        gardenaConfigId: true,
        lastUpdate: true,
        offlineNotifiedAt: true,
      },
    });
    if (devices.length === 0) continue;

    // Shelly-Cloud-Status einmal pro Account holen. Schlaegt der Abruf fehl
    // (null), werden Shelly-Geraete in diesem Tick NICHT geprueft – sonst
    // wuerde ein Cloud-Ausfall alle Geraete faelschlich offline melden.
    let shellyMap: Map<string, { online: boolean }> | null = null;
    if (devices.some((d) => d.type === "SHELLY" && d.shellyId)) {
      const config = await prisma.apiConfig.findFirst({
        where: { accountId, provider: "SHELLY" },
        select: { token: true, baseUrl: true },
      });
      if (config?.token && config?.baseUrl) {
        shellyMap = await shellyCloudAllStatuses(config.baseUrl, config.token);
      }
    }

    // GARDENA-Status je Verbindung (Mandant kann mehrere Konten haben).
    const gardenaMaps = new Map<number, Map<string, { online: boolean }>>();
    let gardenaFallbackConfigId: number | null = null;
    if (devices.some((d) => d.type === "GARDENA_VALVE" && d.gardenaServiceId)) {
      const configs = await prisma.apiConfig.findMany({
        where: { accountId, provider: "GARDENA" },
        select: { id: true, token: true, extraConfig: true },
      });
      gardenaFallbackConfigId = configs[0]?.id ?? null;
      await Promise.all(
        configs.map(async (c) => {
          if (!c.token || !c.extraConfig) return;
          const map = await gardenaStatusMap(c.token, c.extraConfig);
          if (map.size > 0) gardenaMaps.set(c.id, map);
        }),
      );
    }

    const wentOffline: DeviceRow[] = [];
    const cameOnline: DeviceRow[] = [];

    for (const device of devices) {
      const online = resolveOnline(device, now, shellyMap, gardenaMaps, gardenaFallbackConfigId);
      if (online === null) continue;
      result.devicesChecked++;

      if (!online && !device.offlineNotifiedAt) wentOffline.push(device);
      else if (online && device.offlineNotifiedAt) cameOnline.push(device);
    }

    if (wentOffline.length === 0 && cameOnline.length === 0) continue;

    // Erst DB-Zustand fortschreiben, dann senden – schlaegt der Push fehl,
    // gibt es keine Dauerschleife aus Wiederholungs-Benachrichtigungen.
    if (wentOffline.length > 0) {
      await prisma.device.updateMany({
        where: { id: { in: wentOffline.map((d) => d.id) } },
        data: { offlineNotifiedAt: new Date() },
      });
    }
    if (cameOnline.length > 0) {
      await prisma.device.updateMany({
        where: { id: { in: cameOnline.map((d) => d.id) } },
        data: { offlineNotifiedAt: null },
      });
    }

    if (wentOffline.length > 0) {
      const names = wentOffline.map((d) => d.name);
      result.wentOffline.push(...names);
      const single = wentOffline.length === 1;
      const push = await notifyOutage(accountId, {
        title: single ? "⚠️ Gerät offline" : `⚠️ ${wentOffline.length} Geräte offline`,
        body: single
          ? `${names[0]} ist nicht mehr erreichbar.`
          : `Nicht mehr erreichbar: ${names.join(", ")}`,
        url: single ? `/devices/${wentOffline[0].id}` : "/devices",
        tag: "device-offline",
      });
      result.pushed += push.pushed + push.telegram;
    }

    if (cameOnline.length > 0) {
      const names = cameOnline.map((d) => d.name);
      result.cameOnline.push(...names);
      const single = cameOnline.length === 1;
      const push = await notifyOutage(accountId, {
        title: single ? "✅ Gerät wieder online" : `✅ ${cameOnline.length} Geräte wieder online`,
        body: single
          ? `${names[0]} ist wieder erreichbar.`
          : `Wieder erreichbar: ${names.join(", ")}`,
        url: single ? `/devices/${cameOnline[0].id}` : "/devices",
        tag: "device-online",
      });
      result.pushed += push.pushed + push.telegram;
    }
  }

  return result;
}
