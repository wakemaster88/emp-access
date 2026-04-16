import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { controlShelly } from "@/lib/shelly";
import { getSunTimesForAccount } from "@/lib/sun";
import type { ShellyAction, AutomationTrigger } from "@prisma/client";

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

export type TriggerKind = "schedule" | "sunrise" | "sunset" | "manual";

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

  const group = await prisma.shellyGroup.findFirst({
    where: { id: groupId, accountId },
    include: {
      members: {
        include: { device: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!group) {
    const res: ExecuteResult = { success: false, members: [], durationMs: 0 };
    await logRun(accountId, automationId, groupId, trigger, false, res, "Gruppe nicht gefunden");
    return res;
  }

  const memberResults: MemberResult[] = await Promise.all(
    group.members.map(async (m) => {
      const actionStr = m.action.toLowerCase() as "on" | "off" | "toggle";
      try {
        const ok = await controlShelly(
          {
            ipAddress: m.device.ipAddress,
            shellyId: m.device.shellyId,
            shellyAuthKey: m.device.shellyAuthKey,
          },
          actionStr,
          m.timerSeconds ?? undefined
        );
        return {
          memberId: m.id,
          deviceId: m.deviceId,
          deviceName: m.device.name,
          action: m.action,
          timerSeconds: m.timerSeconds,
          ok,
          error: ok ? undefined : "Gerät nicht erreichbar",
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
    } else {
      triggerKind = a.trigger === ("SUNRISE" as AutomationTrigger) ? "sunrise" : "sunset";
      const sun = getSunTimesForAccount(a.account.latitude, a.account.longitude, now);
      const base = triggerKind === "sunrise" ? sun.sunrise : sun.sunset;
      if (!base) continue;
      scheduledAt = new Date(base.getTime() + a.offsetMinutes * 60_000);
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
