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
 * Raums): waehrend der Betriebszeit `targetC`, `preheatMinutes` vorher schon
 * ebenfalls, ausserhalb `setbackC` oder Heizung aus.
 *
 * Sicherheit:
 *  - Jedes "an" geht mit dem geraeteeigenen Auto-Off-Timer (WATCHDOG_SEC) raus
 *    und wird in jedem Takt erneuert. Faellt die Cloud aus, schaltet die
 *    Heizung von selbst ab statt durchzuheizen.
 *  - Meldet der Fuehler nichts oder einen veralteten Wert, geht die Heizung aus.
 *
 * Laeuft im 5-Minuten-Takt (`/api/cron/tick-5min`).
 */

import { prisma } from "@/lib/prisma";
import { isOperatingAt, type ScheduleSpec } from "@/lib/operating-hours";
import { scheduleSpecInclude, toScheduleSpec } from "@/lib/operating-queries";
import {
  shellyBaseId,
  shellyCloudAllStatuses,
  shellySwitchIndex,
  type ShellyDeviceStatusMap,
} from "@/lib/shelly-cloud";
import { shellySetRelay } from "@/lib/shelly-relay";
import { readTemperatureC } from "@/lib/shelly-sensor";
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

/** Soll fuer diesen Moment: Betriebszeit (mit Vorheizen) → targetC, sonst setbackC. */
export function climateTarget(
  climate: { targetC: number; setbackC: number | null; preheatMinutes: number },
  schedule: ScheduleSpec | null,
  now: Date,
  tz: string,
): { targetC: number | null; open: boolean } {
  if (!schedule) return { targetC: climate.targetC, open: true };
  const open =
    isOperatingAt(schedule, now, tz) ||
    (climate.preheatMinutes > 0 && isOperatingAt(schedule, new Date(now.getTime() + climate.preheatMinutes * 60_000), tz));
  return { targetC: open ? climate.targetC : climate.setbackC, open };
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
      const { targetC } = climateTarget(c, record ? toScheduleSpec(record) : null, now, tz);

      // Messwert
      let tempC: number | null = null;
      let readAt: Date | null = null;
      const baseId = shellyBaseId(c.sensorDevice.shellyId);
      const entry = baseId && statuses ? statuses.get(baseId) ?? statuses.get(baseId.toLowerCase()) : undefined;
      if (entry) {
        tempC = readTemperatureC(entry.status);
        readAt = statusUpdatedAt(entry.status) ?? (entry.online ? now : null);
      }
      const fresh = !!readAt && now.getTime() - readAt.getTime() <= STALE_READING_MIN * 60_000;
      const decision = climateDecision({ tempC, fresh, targetC, hysteresisC: c.hysteresisC, heating: c.heating });

      // Schalten: bei Wechsel, und solange geheizt wird in jedem Takt (Watchdog).
      const mustSend = decision.heat || c.heating !== false;
      let sendError: string | null = null;
      if (mustSend) {
        if (!cloud && ON_VERCEL) sendError = "Shelly Cloud nicht eingerichtet";
        else {
          const heaters = await prisma.device.findMany({
            where: { id: { in: c.heaterDeviceIds }, accountId, type: "SHELLY", isActive: true },
            select: { id: true, name: true, ipAddress: true, shellyId: true },
          });
          if (heaters.length === 0) sendError = "Keine aktive Heizung zugeordnet";
          const failed: string[] = [];
          for (const h of heaters) {
            const ok = await shellySetRelay(
              { ipAddress: ON_VERCEL ? null : h.ipAddress, baseId: shellyBaseId(h.shellyId) },
              cloud,
              shellySwitchIndex(h.shellyId),
              decision.heat,
              decision.heat ? WATCHDOG_SEC : undefined,
            ).catch(() => false);
            if (ok) {
              await prisma.device.update({ where: { id: h.id }, data: { task: decision.heat ? 1 : 3 } });
            } else failed.push(h.name);
            // Shelly Cloud erlaubt ~1 Anfrage pro Sekunde.
            await sleep(1100);
          }
          if (failed.length) sendError = `Schalten fehlgeschlagen: ${failed.join(", ")}`;
        }
      }

      const error = decision.sensorError ?? sendError;
      const changed = mustSend && !sendError && c.heating !== decision.heat;
      if (changed) result.switched++;
      if (error) result.errors++;

      await prisma.roomClimate.update({
        where: { id: c.id },
        data: {
          lastTempC: tempC ?? c.lastTempC,
          lastReadAt: readAt ?? c.lastReadAt,
          currentTargetC: targetC,
          lastError: error,
          ...(mustSend && !sendError ? { heating: decision.heat } : {}),
          ...(changed ? { lastSwitchAt: now } : {}),
        },
      });

      // Einmal melden, wenn ein Fehler neu auftritt.
      if (error && !c.lastError) {
        await sendPushToAccount(accountId, {
          title: `Klima ${c.room.name}`,
          body: `${error}. Die Heizung ist aus Sicherheitsgründen aus.`,
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
    operatingScheduleId: c.operatingScheduleId,
    lastTempC: c.lastTempC,
    lastReadAt: c.lastReadAt?.toISOString() ?? null,
    heating: c.heating,
    lastSwitchAt: c.lastSwitchAt?.toISOString() ?? null,
    currentTargetC: c.currentTargetC,
    lastError: c.lastError,
  };
}

