import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { controlShelly } from "@/lib/shelly";
import { runCoverAction } from "@/lib/shelly-cover";
import { isCoverDevice, type CoverAction } from "@/lib/cover-constants";
import { getSunTimesForAccount } from "@/lib/sun";
import type { ShellyAction, AutomationTrigger } from "@prisma/client";

/** Shelly-Cloud-Server, wenn im Account keiner hinterlegt ist. */
const DEFAULT_CLOUD_SERVER = "shelly-46-eu.shelly.cloud";

/** Szenen-Aktion → Fahrbefehl eines Antriebs. */
const COVER_ACTIONS: Partial<Record<ShellyAction, CoverAction>> = {
  OPEN: "open",
  CLOSE: "close",
  STOP: "stop",
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemberResult {
  memberId: number;
  deviceId: number;
  deviceName: string;
  action: ShellyAction;
  timerSeconds: number | null;
  ok: boolean;
  error?: string;
}

export interface ExecuteResult {
  success: boolean;
  members: MemberResult[];
  durationMs: number;
}

export type TriggerKind = "schedule" | "sunrise" | "sunset" | "manual" | "camera";

const CAMERA_EVENT_TYPES = ["MOTION", "PERSON", "VEHICLE", "ANIMAL", "OTHER"] as const;

// ─── Member Execution ────────────────────────────────────────────────────────

interface MemberDevice {
  type: string;
  category: string | null;
  ipAddress: string | null;
  shellyId: string | null;
  shellyAuthKey: string | null;
  coverUpChannel: number | null;
  coverDownChannel: number | null;
  coverRuntimeSec: number | null;
}

const SWITCH_ACTIONS: Partial<Record<ShellyAction, "on" | "off" | "toggle">> = {
  ON: "on",
  OFF: "off",
  TOGGLE: "toggle",
};

async function runMemberSwitch(
  device: MemberDevice,
  action: ShellyAction,
  timerSeconds: number | null,
  cloudServer: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const actionStr = SWITCH_ACTIONS[action];
  if (!actionStr) {
    return { ok: false, error: "Auf/Zu/Stopp gibt es nur bei Markisen und Rolltoren" };
  }
  const ok = await controlShelly(
    {
      ipAddress: device.ipAddress,
      shellyId: device.shellyId,
      shellyAuthKey: device.shellyAuthKey,
      cloudServer: cloudServer ?? undefined,
    },
    actionStr,
    timerSeconds ?? undefined,
  );
  return { ok, error: ok ? undefined : "Gerät nicht erreichbar" };
}

async function runMemberCover(
  device: MemberDevice,
  action: ShellyAction,
  cloudServer: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const coverAction = COVER_ACTIONS[action];
  if (!coverAction) {
    return { ok: false, error: "Ein Antrieb kennt nur Auf, Zu und Stopp" };
  }
  const cloud = device.shellyAuthKey
    ? { baseUrl: cloudServer ?? DEFAULT_CLOUD_SERVER, token: device.shellyAuthKey }
    : null;
  const res = await runCoverAction(
    {
      type: device.type,
      category: device.category,
      ipAddress: device.ipAddress,
      shellyId: device.shellyId,
      coverUpChannel: device.coverUpChannel,
      coverDownChannel: device.coverDownChannel,
      coverRuntimeSec: device.coverRuntimeSec,
    },
    cloud,
    coverAction,
  );
  return { ok: res.ok, error: res.error };
}

// ─── Group Execution ─────────────────────────────────────────────────────────

/**
 * Führt alle Member einer Gruppe aus. Aktionen laufen parallel, damit eine Szene
 * gleichzeitig schaltet. Ein fehlgeschlagenes Member-Gerät blockiert die anderen
 * nicht; das Gesamt-Success-Flag wird nur true, wenn ALLE Member erfolgreich sind.
 *
 * Logging: Persistiert einen ShellyAutomationRun-Eintrag.
 */
export async function executeGroup(
  groupId: number,
  accountId: number,
  trigger: TriggerKind,
  automationId: number | null = null
): Promise<ExecuteResult> {
  const startedAt = Date.now();

  const [group, shellyCloud] = await Promise.all([
    prisma.shellyGroup.findFirst({
      where: { id: groupId, accountId },
      include: {
        members: {
          include: { device: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    }),
    prisma.apiConfig.findFirst({
      where: { accountId, provider: "SHELLY" },
      select: { baseUrl: true },
    }),
  ]);

  if (!group) {
    const res: ExecuteResult = { success: false, members: [], durationMs: 0 };
    await logRun(accountId, automationId, groupId, trigger, false, res, "Gruppe nicht gefunden");
    return res;
  }

  const memberResults: MemberResult[] = await Promise.all(
    group.members.map(async (m) => {
      try {
        const { ok, error } = isCoverDevice(m.device)
          ? await runMemberCover(m.device, m.action, shellyCloud?.baseUrl ?? null)
          : await runMemberSwitch(m.device, m.action, m.timerSeconds, shellyCloud?.baseUrl ?? null);
        return {
          memberId: m.id,
          deviceId: m.deviceId,
          deviceName: m.device.name,
          action: m.action,
          timerSeconds: m.timerSeconds,
          ok,
          error,
        };
      } catch (err) {
        return {
          memberId: m.id,
          deviceId: m.deviceId,
          deviceName: m.device.name,
          action: m.action,
          timerSeconds: m.timerSeconds,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  const allOk = memberResults.length > 0 && memberResults.every((r) => r.ok);
  const result: ExecuteResult = {
    success: allOk,
    members: memberResults,
    durationMs: Date.now() - startedAt,
  };

  await logRun(accountId, automationId, groupId, trigger, allOk, result);
  return result;
}

async function logRun(
  accountId: number,
  automationId: number | null,
  groupId: number,
  trigger: TriggerKind,
  success: boolean,
  result: ExecuteResult,
  errorMessage?: string
) {
  try {
    await prisma.shellyAutomationRun.create({
      data: {
        accountId,
        automationId: automationId ?? null,
        groupId,
        triggerKind: trigger,
        success,
        details: { members: result.members } as unknown as Prisma.InputJsonValue,
        durationMs: result.durationMs,
        errorMessage: errorMessage ?? null,
      },
    });
  } catch (err) {
    // Log-Fehler dürfen die Ausführung nicht abbrechen.
    console.error("[shelly-automation] logRun failed:", err);
  }
}

// ─── Cron / Tick ──────────────────────────────────────────────────────────────

/**
 * Berechnet für einen gegebenen Zeitpunkt (typisch: "now"), welche Automationen
 * ausgelöst werden sollen. Wird vom Cron-Endpoint aufgerufen.
 *
 * Fenster: ±2 Minuten um die geplante Zeit, kombiniert mit lastRunAt-Check
 * (verhindert Doppelausführung, wenn der Cron häufiger als 1x pro Minute läuft).
 */
export async function runAutomationTick(now: Date = new Date()): Promise<{
  checked: number;
  triggered: number;
  results: Array<{ automationId: number; accountId: number; trigger: TriggerKind; success: boolean; memberCount: number }>;
}> {
  const FIRE_WINDOW_MS = 2 * 60_000;
  const RERUN_GUARD_MS = 5 * 60_000;

  // Zuerst alle aktiven Automationen + dazugehörige Accounts laden.
  const automations = await prisma.shellyAutomation.findMany({
    where: { isActive: true },
    include: { account: { select: { latitude: true, longitude: true, timezone: true } } },
  });

  const results: Array<{
    automationId: number;
    accountId: number;
    trigger: TriggerKind;
    success: boolean;
    memberCount: number;
  }> = [];

  let triggered = 0;

  for (const a of automations) {
    // Kamera-Automationen werden event-getrieben ausgeloest, nicht per Cron.
    if (a.trigger === ("CAMERA_EVENT" as AutomationTrigger)) continue;

    const dow = berlinWeekdayBitIndex(now, a.account.timezone);
    const todayAllowed = ((a.daysOfWeek >> dow) & 1) === 1;
    if (!todayAllowed) continue;

    // Idempotenz: Wenn innerhalb der letzten 5 Minuten schon gelaufen, skip.
    if (a.lastRunAt && now.getTime() - a.lastRunAt.getTime() < RERUN_GUARD_MS) {
      continue;
    }

    let scheduledAt: Date | null = null;
    let triggerKind: TriggerKind;

    if (a.trigger === ("SCHEDULE" as AutomationTrigger)) {
      triggerKind = "schedule";
      if (!a.timeOfDay) continue;
      scheduledAt = berlinTimeOfDayToUtc(now, a.timeOfDay, a.account.timezone);
    } else if (
      a.trigger === ("SUNRISE" as AutomationTrigger) ||
      a.trigger === ("SUNSET" as AutomationTrigger)
    ) {
      triggerKind = a.trigger === ("SUNRISE" as AutomationTrigger) ? "sunrise" : "sunset";
      const sun = getSunTimesForAccount(a.account.latitude, a.account.longitude, now);
      const base = triggerKind === "sunrise" ? sun.sunrise : sun.sunset;
      if (!base) continue;
      scheduledAt = new Date(base.getTime() + a.offsetMinutes * 60_000);
    } else {
      continue;
    }

    if (!scheduledAt) continue;

    const delta = Math.abs(now.getTime() - scheduledAt.getTime());
    if (delta > FIRE_WINDOW_MS) continue;

    // Auslösen + lastRunAt in einer Transaktion setzen (mit compound-Check,
    // damit parallele Cron-Invocations nicht doppelt feuern).
    const claimed = await prisma.shellyAutomation.updateMany({
      where: {
        id: a.id,
        OR: [
          { lastRunAt: null },
          { lastRunAt: { lt: new Date(now.getTime() - RERUN_GUARD_MS) } },
        ],
      },
      data: { lastRunAt: now },
    });
    if (claimed.count === 0) continue;

    triggered++;
    const res = await executeGroup(a.groupId, a.accountId, triggerKind, a.id);
    results.push({
      automationId: a.id,
      accountId: a.accountId,
      trigger: triggerKind,
      success: res.success,
      memberCount: res.members.length,
    });
  }

  return { checked: automations.length, triggered, results };
}

/**
 * Wird beim Start eines Kamera-Ereignisses (Hub-Ingest) aufgerufen.
 * Findet passende CAMERA_EVENT-Automationen und fuehrt deren Szene aus.
 */
export async function runCameraAutomations(
  accountId: number,
  cameraId: number,
  eventType: string,
  now: Date = new Date()
): Promise<{ triggered: number }> {
  if (!CAMERA_EVENT_TYPES.includes(eventType as (typeof CAMERA_EVENT_TYPES)[number])) {
    return { triggered: 0 };
  }

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { timezone: true },
  });
  if (!account) return { triggered: 0 };

  const automations = await prisma.shellyAutomation.findMany({
    where: {
      accountId,
      isActive: true,
      trigger: "CAMERA_EVENT",
      cameraId,
      eventType,
    },
  });

  let triggered = 0;
  for (const a of automations) {
    const dow = berlinWeekdayBitIndex(now, account.timezone);
    if (((a.daysOfWeek >> dow) & 1) !== 1) continue;

    if (a.windowStart && a.windowEnd) {
      if (!isWithinTimeWindow(now, a.windowStart, a.windowEnd, account.timezone)) continue;
    }

    const cooldownMs = Math.max(1, a.cooldownMinutes) * 60_000;
    if (a.lastRunAt && now.getTime() - a.lastRunAt.getTime() < cooldownMs) continue;

    const claimed = await prisma.shellyAutomation.updateMany({
      where: {
        id: a.id,
        OR: [
          { lastRunAt: null },
          { lastRunAt: { lt: new Date(now.getTime() - cooldownMs) } },
        ],
      },
      data: { lastRunAt: now },
    });
    if (claimed.count === 0) continue;

    triggered++;
    await executeGroup(a.groupId, accountId, "camera", a.id);
  }

  return { triggered };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minuten seit Mitternacht in der Account-Zeitzone. */
function minutesInTz(now: Date, tz: string | null | undefined): number {
  const timeZone = tz ?? "Europe/Berlin";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  // en-GB kann "24" fuer Mitternacht liefern
  return ((h === 24 ? 0 : h) * 60) + m;
}

function parseHhmmToMinutes(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Prueft, ob `now` im Fenster [start, end) liegt.
 * end < start bedeutet Ueber-Mitternacht (z. B. 22:00–08:00).
 */
export function isWithinTimeWindow(
  now: Date,
  start: string,
  end: string,
  tz: string | null | undefined
): boolean {
  const startM = parseHhmmToMinutes(start);
  const endM = parseHhmmToMinutes(end);
  if (startM == null || endM == null) return false;
  const mins = minutesInTz(now, tz);
  if (startM === endM) return true;
  if (startM < endM) return mins >= startM && mins < endM;
  return mins >= startM || mins < endM;
}

/**
 * Liefert den Wochentag als Bit-Index (0=Mo, 1=Di, …, 6=So) in der angegebenen
 * IANA-Zeitzone (fallback: Europe/Berlin). Nutzt Intl.DateTimeFormat, kein deps.
 */
function berlinWeekdayBitIndex(now: Date, tz: string | null | undefined): number {
  const timeZone = tz ?? "Europe/Berlin";
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" })
    .format(now)
    .toLowerCase();
  // Map short to bit (bit0=Mo)
  const map: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
  return map[weekday] ?? 0;
}

/**
 * Konvertiert "HH:mm" in der Account-Zeitzone zu einem UTC-Date für "heute"
 * in dieser Zeitzone. Robust gegen DST, nutzt Intl.DateTimeFormat.
 */
function berlinTimeOfDayToUtc(now: Date, hhmm: string, tz: string | null | undefined): Date {
  const timeZone = tz ?? "Europe/Berlin";
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = Number(mStr);

  // Heutiges Datum in der Ziel-Zeitzone ermitteln
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const mo = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  // Versuche: Konstruiere UTC-Zeit für y-mo-d h:m in der Ziel-TZ über
  // Fixpunkt-Näherung (2 Iterationen reichen für alle Zeitzonen, DST inklusive).
  let guess = new Date(Date.UTC(y, mo - 1, d, h, m, 0));
  for (let i = 0; i < 2; i++) {
    const shown = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(guess);
    const gy = Number(shown.find((p) => p.type === "year")?.value);
    const gmo = Number(shown.find((p) => p.type === "month")?.value);
    const gd = Number(shown.find((p) => p.type === "day")?.value);
    const gh = Number(shown.find((p) => p.type === "hour")?.value);
    const gm = Number(shown.find((p) => p.type === "minute")?.value);

    const shownUtc = Date.UTC(gy, gmo - 1, gd, gh, gm, 0);
    const targetUtc = Date.UTC(y, mo - 1, d, h, m, 0);
    const diff = targetUtc - shownUtc;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}
