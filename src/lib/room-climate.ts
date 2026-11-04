/**
 * Klima je Raum: eine Solltemperatur halten.
 *
 * Ein Fuehler (Shelly, auch BLU H&T ueber die Shelly Cloud) misst, eine oder
 * mehrere Heizungen (Shelly-Kanaele) schalten mit Hysterese:
 *
 *   unter Soll − Hysterese → Heizung an
 *   ueber  Soll + Hysterese → Heizung aus
 *   dazwischen              → Zustand bleibt
 *
 * Das Soll richtet sich nach der Betriebszeit (die des Klimas, sonst die des
 * Raums): waehrend der Betriebszeit `targetC`, `preheatMinutes` vorher und
 * `afterrunMinutes` nachher ebenfalls, sonst `setbackC` oder Heizung aus.
 * Beispiel Wasserski 12–16 Uhr, 30 Min. vor, 30 Min. nach → Heizen 11:30–16:30.
 *
 * Sicherheit:
 *  - Jedes "an" geht mit dem geraeteeigenen Auto-Off-Timer (WATCHDOG_SEC) raus
 *    und wird in jedem Takt erneuert. Faellt die Cloud aus, schaltet die
 *    Heizung von selbst ab statt durchzuheizen.
 *  - Meldet der Fuehler nichts oder einen veralteten Wert, geht die Heizung aus.
 *
 * Lueftung (optional, `fanDeviceIds`): nach Luftfeuchte mit Hysterese
 * (an ab `fanOnHumidity`, aus unter `fanOffHumidity`), nach Betriebsende
 * `fanAfterrunMinutes` lang immer an (Anzuege trocknen), und unter
 * `fanMinTempC` nie (Frostschutz geht vor).
 *
 * Laeuft im 5-Minuten-Takt (`/api/cron/tick-5min`).
 */

import { prisma } from "@/lib/prisma";
import { recordCloudSample } from "@/lib/climate-history";
import { isOperatingAt, isWithinOperatingSpan, type ScheduleSpec, type SpanOffsets } from "@/lib/operating-hours";
import { scheduleSpecInclude, toScheduleSpec } from "@/lib/operating-queries";
import {
  shellyBaseId,
  shellyCloudAllStatuses,
  shellySwitchIndex,
  type ShellyDeviceStatusMap,
} from "@/lib/shelly-cloud";
import { shellySetRelay } from "@/lib/shelly-relay";
import { readHumidityPercent, readTemperatureC } from "@/lib/shelly-sensor";
import { sendPushToAccount } from "@/lib/web-push";
import { DEFAULT_TIMEZONE } from "@/lib/tz-time";

/** Auto-Off-Timer der Heizung; der Takt erneuert ihn alle 5 Minuten. */
export const WATCHDOG_SEC = 15 * 60;
/** Ab diesem Alter gilt ein Messwert als veraltet. */
export const STALE_READING_MIN = 120;
/** Grenzen fuer Eingaben. */
export const CLIMATE_LIMITS = {
  minC: 5,
  maxC: 30,
  maxHysteresisC: 3,
  maxPreheatMinutes: 240,
  maxAfterrunMinutes: 240,
  maxFanAfterrunMinutes: 240,
} as const;

// ─── Reine Entscheidung (ohne I/O, testbar) ──────────────────────────────────

export interface ClimateDecisionInput {
  tempC: number | null;
  /** Messwert juenger als STALE_READING_MIN. */
  fresh: boolean;
  /** Aktuelles Soll; null = Heizung aus (ausserhalb der Betriebszeit). */
  targetC: number | null;
  hysteresisC: number;
  /** Zuletzt gesendeter Zustand. */
  heating: boolean | null;
}

export interface ClimateDecision {
  heat: boolean;
  reason: string;
  /** Fuehlerproblem: Heizung aus und Fehler melden. */
  sensorError?: string;
}

export function climateDecision(input: ClimateDecisionInput): ClimateDecision {
  if (input.targetC === null) return { heat: false, reason: "außerhalb der Betriebszeit" };
  if (input.tempC === null) {
    return { heat: false, reason: "Fühler meldet keine Temperatur", sensorError: "Fühler meldet keine Temperatur" };
  }
  if (!input.fresh) {
    return { heat: false, reason: "Messwert veraltet", sensorError: `Fühler seit über ${STALE_READING_MIN} min ohne neuen Wert` };
  }
  const h = Math.max(0, input.hysteresisC);
  if (input.tempC < input.targetC - h) return { heat: true, reason: "unter Soll" };
  if (input.tempC > input.targetC + h) return { heat: false, reason: "über Soll" };
  return { heat: input.heating ?? input.tempC < input.targetC, reason: "im Sollbereich" };
}

/** Heizfenster relativ zur Betriebszeit: Vorheizen vorher, Nachlauf nachher. */
export function climateOffsets(climate: { preheatMinutes: number; afterrunMinutes?: number | null }): SpanOffsets {
  return { openMinutes: -Math.max(0, climate.preheatMinutes), closeMinutes: Math.max(0, climate.afterrunMinutes ?? 0) };
}

/** Soll fuer diesen Moment: Heizfenster (Betriebszeit ± Vor-/Nachlauf) → targetC, sonst setbackC. */
export function climateTarget(
  climate: { targetC: number; setbackC: number | null; preheatMinutes: number; afterrunMinutes?: number | null },
  schedule: ScheduleSpec | null,
  now: Date,
  tz: string,
): { targetC: number | null; open: boolean } {
  if (!schedule) return { targetC: climate.targetC, open: true };
  const open = isWithinOperatingSpan(schedule, now, tz, climateOffsets(climate));
  return { targetC: open ? climate.targetC : climate.setbackC, open };
}

export interface VentDecisionInput {
  humidity: number | null;
  tempC: number | null;
  /** Messwert juenger als STALE_READING_MIN. */
  fresh: boolean;
  onHumidity: number;
  offHumidity: number;
  minTempC: number;
  /** Liegt der Moment im Nachlauf nach Betriebsende? */
  afterrun: boolean;
  /** Zuletzt gesendeter Zustand. */
  fanOn: boolean | null;
}

export function ventDecision(input: VentDecisionInput): { on: boolean; reason: string } {
  if (input.fresh && input.tempC !== null && input.tempC < input.minTempC) {
    return { on: false, reason: "Frostschutz" };
  }
  if (input.afterrun) return { on: true, reason: "Nachlauf nach Betriebsende" };
  if (!input.fresh || input.humidity === null) return { on: false, reason: "keine Luftfeuchte" };
  if (input.humidity >= input.onHumidity) return { on: true, reason: "Luftfeuchte hoch" };
  if (input.humidity < input.offHumidity) return { on: false, reason: "Luftfeuchte ok" };
  return { on: input.fanOn ?? false, reason: "im Bereich" };
}

/** Nachlauf: nach Betriebsende, bis `minutes` danach (nicht waehrend des Betriebs). */
export function inAfterrun(schedule: ScheduleSpec | null, now: Date, tz: string, minutes: number): boolean {
  if (!schedule || minutes <= 0) return false;
  return (
    !isOperatingAt(schedule, now, tz) &&
    isWithinOperatingSpan(schedule, now, tz, { openMinutes: 0, closeMinutes: minutes })
  );
}

// ─── Messwert aus dem Cloud-Status ───────────────────────────────────────────

/** Zeitpunkt des Status: `_updated` der Shelly Cloud oder `ts`/`sys.unixtime`. */
export function statusUpdatedAt(status: ShellyDeviceStatusMap): Date | null {
  const candidates: number[] = [];
  const updated = status._updated;
  if (typeof updated === "string") {
    // Shelly Cloud: "YYYY-MM-DD HH:mm:ss" in UTC.
    const t = Date.parse(`${updated.replace(" ", "T")}Z`);
    if (Number.isFinite(t)) candidates.push(t);
  }
  const sys = status.sys as { unixtime?: unknown } | undefined;
  if (typeof sys?.unixtime === "number") candidates.push(sys.unixtime * 1000);
  for (const [key, value] of Object.entries(status)) {
    if (!key.startsWith("temperature")) continue;
    const ts = (value as { ts?: unknown } | null)?.ts;
    if (typeof ts === "number") candidates.push(ts * 1000);
  }
  return candidates.length ? new Date(Math.max(...candidates)) : null;
}

// ─── Takt ────────────────────────────────────────────────────────────────────

export interface ClimateTickResult {
  climates: number;
  switched: number;
  errors: number;
}

const ON_VERCEL = !!process.env.VERCEL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Shelly-Kanaele schalten; "an" immer mit Auto-Off-Timer (Watchdog).
 * Liefert eine Fehlermeldung oder null.
 */
async function switchDevices(
  accountId: number,
  ids: number[],
  on: boolean,
  cloud: { token: string; baseUrl: string } | null,
  what: string,
): Promise<string | null> {
  if (!cloud && ON_VERCEL) return "Shelly Cloud nicht eingerichtet";
  const devices = await prisma.device.findMany({
    where: { id: { in: ids }, accountId, type: "SHELLY", isActive: true },
    select: { id: true, name: true, ipAddress: true, shellyId: true },
  });
  if (devices.length === 0) return `Keine aktive ${what} zugeordnet`;
  const failed: string[] = [];
  for (const d of devices) {
    const ok = await shellySetRelay(
      { ipAddress: ON_VERCEL ? null : d.ipAddress, baseId: shellyBaseId(d.shellyId) },
      cloud,
      shellySwitchIndex(d.shellyId),
      on,
      on ? WATCHDOG_SEC : undefined,
    ).catch(() => false);
    if (ok) await prisma.device.update({ where: { id: d.id }, data: { task: on ? 1 : 3 } });
    else failed.push(d.name);
    // Shelly Cloud erlaubt ~1 Anfrage pro Sekunde.
    await sleep(1100);
  }
  return failed.length ? `Schalten fehlgeschlagen: ${failed.join(", ")}` : null;
}

export async function runClimateTick(now = new Date()): Promise<ClimateTickResult> {
  const climates = await prisma.roomClimate.findMany({
    where: { isActive: true },
    include: {
      account: { select: { id: true, timezone: true } },
      room: { select: { id: true, name: true, operatingSchedule: { include: scheduleSpecInclude } } },
      operatingSchedule: { include: scheduleSpecInclude },
      sensorDevice: { select: { id: true, shellyId: true, isActive: true } },
    },
    orderBy: { id: "asc" },
  });
  const result: ClimateTickResult = { climates: climates.length, switched: 0, errors: 0 };
  if (climates.length === 0) return result;

  const byAccount = new Map<number, typeof climates>();
  for (const c of climates) byAccount.set(c.accountId, [...(byAccount.get(c.accountId) ?? []), c]);

  for (const [accountId, list] of byAccount) {
    const config = await prisma.apiConfig.findFirst({ where: { accountId, provider: "SHELLY" } });
    const cloud = config?.token && config?.baseUrl ? { token: config.token, baseUrl: config.baseUrl } : null;
    const statuses = cloud ? await shellyCloudAllStatuses(cloud.baseUrl, cloud.token) : null;

    for (const c of list) {
      const tz = c.account.timezone || DEFAULT_TIMEZONE;
      const record = c.operatingSchedule ?? c.room.operatingSchedule ?? null;
      const spec = record ? toScheduleSpec(record) : null;
      const { targetC } = climateTarget(c, spec, now, tz);

      // Messwert
      let tempC: number | null = null;
      let humidity: number | null = null;
      let readAt: Date | null = null;
      const baseId = shellyBaseId(c.sensorDevice.shellyId);
      const entry = baseId && statuses ? statuses.get(baseId) ?? statuses.get(baseId.toLowerCase()) : undefined;
      if (entry) {
        tempC = readTemperatureC(entry.status);
        humidity = readHumidityPercent(entry.status);
        readAt = statusUpdatedAt(entry.status) ?? (entry.online ? now : null);
      }
      const fresh = !!readAt && now.getTime() - readAt.getTime() <= STALE_READING_MIN * 60_000;
      // Verlauf: Notnagel, falls der Hub fuer dieses Fenster nichts gemeldet hat.
      if (entry && readAt) {
        await recordCloudSample({ accountId, deviceId: c.sensorDevice.id, roomId: c.room.id, at: readAt, tempC, humidity }).catch(
          () => undefined,
        );
      }

      // Heizung: bei Wechsel, und solange geheizt wird in jedem Takt (Watchdog).
      const hasHeater = c.heaterDeviceIds.length > 0;
      const decision = climateDecision({ tempC, fresh, targetC, hysteresisC: c.hysteresisC, heating: c.heating });
      const mustSend = hasHeater && (decision.heat || c.heating !== false);
      const sendError = mustSend ? await switchDevices(accountId, c.heaterDeviceIds, decision.heat, cloud, "Heizung") : null;

      // Lueftung: gleiches Muster.
      const hasFan = c.fanDeviceIds.length > 0;
      const vent = ventDecision({
        humidity,
        tempC,
        fresh,
        onHumidity: c.fanOnHumidity,
        offHumidity: c.fanOffHumidity,
        minTempC: c.fanMinTempC,
        afterrun: inAfterrun(spec, now, tz, c.fanAfterrunMinutes),
        fanOn: c.fanOn,
      });
      const fanSend = hasFan && (vent.on || c.fanOn !== false);
      const fanError = fanSend ? await switchDevices(accountId, c.fanDeviceIds, vent.on, cloud, "Lüftung") : null;

      const error = (hasHeater ? decision.sensorError : null) ?? sendError ?? fanError;
      const changed = mustSend && !sendError && c.heating !== decision.heat;
      if (changed) result.switched++;
      if (fanSend && !fanError && c.fanOn !== vent.on) result.switched++;
      if (error) result.errors++;

      await prisma.roomClimate.update({
        where: { id: c.id },
        data: {
          lastTempC: tempC ?? c.lastTempC,
          lastHumidity: humidity ?? c.lastHumidity,
          lastReadAt: readAt ?? c.lastReadAt,
          currentTargetC: hasHeater ? targetC : null,
          lastError: error,
          ...(mustSend && !sendError ? { heating: decision.heat } : {}),
          ...(changed ? { lastSwitchAt: now } : {}),
          ...(fanSend && !fanError ? { fanOn: vent.on } : {}),
        },
      });

      // Einmal melden, wenn ein Fehler neu auftritt.
      if (error && !c.lastError) {
        await sendPushToAccount(accountId, {
          title: `Klima ${c.room.name}`,
          body: `${error}. Heizung und Lüftung sind aus Sicherheitsgründen aus.`,
          url: "/raeume",
          tag: `climate-${c.id}`,
        }).catch(() => undefined);
      }
    }
  }
  return result;
}

// ─── Anzeige ─────────────────────────────────────────────────────────────────

/** Klima-Status fuer Hub und Oberflaeche. */
export function climateView(c: {
  id: number;
  roomId: number;
  isActive: boolean;
  sensorDeviceId: number;
  heaterDeviceIds: number[];
  targetC: number;
  hysteresisC: number;
  setbackC: number | null;
  preheatMinutes: number;
  afterrunMinutes: number;
  fanDeviceIds: number[];
  fanOnHumidity: number;
  fanOffHumidity: number;
  fanAfterrunMinutes: number;
  fanMinTempC: number;
  fanOn: boolean | null;
  lastHumidity: number | null;
  operatingScheduleId: number | null;
  lastTempC: number | null;
  lastReadAt: Date | null;
  heating: boolean | null;
  lastSwitchAt: Date | null;
  currentTargetC: number | null;
  lastError: string | null;
}) {
  return {
    id: c.id,
    roomId: c.roomId,
    isActive: c.isActive,
    sensorDeviceId: c.sensorDeviceId,
    heaterDeviceIds: c.heaterDeviceIds,
    targetC: c.targetC,
    hysteresisC: c.hysteresisC,
    setbackC: c.setbackC,
    preheatMinutes: c.preheatMinutes,
    afterrunMinutes: c.afterrunMinutes,
    fanDeviceIds: c.fanDeviceIds,
    fanOnHumidity: c.fanOnHumidity,
    fanOffHumidity: c.fanOffHumidity,
    fanAfterrunMinutes: c.fanAfterrunMinutes,
    fanMinTempC: c.fanMinTempC,
    fanOn: c.fanOn,
    lastHumidity: c.lastHumidity,
    operatingScheduleId: c.operatingScheduleId,
    lastTempC: c.lastTempC,
    lastReadAt: c.lastReadAt?.toISOString() ?? null,
    heating: c.heating,
    lastSwitchAt: c.lastSwitchAt?.toISOString() ?? null,
    currentTargetC: c.currentTargetC,
    lastError: c.lastError,
  };
}

