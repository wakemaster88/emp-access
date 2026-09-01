/**
 * Regel-Engine mit Raumbezug. Loest `ShellyGroup`/`ShellyAutomation` ab.
 *
 * Aufbau in drei Schichten:
 *
 *  1. `ruleAllows()` – reine Pruefung der Bedingungen (Wochentag, Zeitfenster,
 *     Betriebszeit, Dunkelheit). Ohne Datenbank, deshalb testbar.
 *  2. `executeRule()` – fuehrt die Aktionen einer Regel aus und schreibt einen
 *     `RoomRuleRun`.
 *  3. Ausloeser – `runRuleTick()` fuer die zeitgesteuerten, dazu je eine
 *     Funktion fuer Bewegung, Schaltvorgang und Scan.
 *
 * Doppelausfuehrung verhindert `claimRule()`: `lastRunAt` wird per `updateMany`
 * mit Bedingung gesetzt, sodass zwei gleichzeitige Cron-Laeufe sich nicht in
 * die Quere kommen. Dasselbe Muster wie bisher, nur mit Sekunden statt
 * fester Fuenf-Minuten-Sperre.
 */

import { Prisma } from "@prisma/client";
import type { RoomRule, RoomRuleAction, RuleTrigger } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { triggerDeviceAction, type DeviceAction } from "@/lib/device-open";
import {
  ensureAnnouncementTrack,
  playlistPayload,
  queueAnnouncement,
  queueZoneCommand,
} from "@/lib/audio";
import { isQuietTime } from "@/lib/audio-constants";
import { sendTelegramMessage } from "@/lib/telegram";
import { sendPushToAccount } from "@/lib/web-push";
import { getSunTimesForAccount } from "@/lib/sun";
import { boundariesForDay, isOperatingAt, type ScheduleSpec } from "@/lib/operating-hours";
import { toScheduleSpec, type ScheduleRecord } from "@/lib/operating-queries";
import { DEFAULT_TIMEZONE, isWithinWindow, tzInstant, tzWeekdayBit, tzYmd } from "@/lib/tz-time";

/** Toleranz um den geplanten Zeitpunkt. Der Cron laeuft alle fuenf Minuten. */
const FIRE_WINDOW_MS = 3 * 60_000;

/**
 * Wie tief darf eine Regel weitere Regeln ausloesen. 1 heisst: eine Regel darf
 * Folgeregeln starten, diese aber keine weiteren. Ohne Grenze koennten sich
 * zwei Regeln endlos gegenseitig schalten.
 */
const MAX_CHAIN_DEPTH = 1;

export interface RuleContext {
  /** Zeitpunkt der Auswertung. */
  now: Date;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  /** Betriebszeit, die fuer diese Regel gilt, bereits aufgeloest. */
  schedule: ScheduleSpec | null;
}

export interface ActionResult {
  actionId: number;
  kind: string;
  target: string;
  ok: boolean;
  error?: string;
}

export interface ExecuteResult {
  success: boolean;
  actions: ActionResult[];
  durationMs: number;
}

/** Bedingungen einer Regel, so weit sie ohne Datenbank pruefbar sind. */
export interface RuleConditions {
  daysOfWeek: number;
  operating: "ANY" | "OPEN" | "CLOSED";
  windowStart: string | null;
  windowEnd: string | null;
  onlyWhenDark: boolean;
}

/**
 * Greifen die Bedingungen der Regel zum Zeitpunkt `ctx.now`?
 *
 * Wichtig fuer die Betriebszeit-Bedingung: ist keine Betriebszeit zustaendig,
 * gilt `OPEN` als erfuellt und `CLOSED` als nicht erfuellt. Ein Raum ohne
 * gepflegtes Profil soll nicht stillschweigend alle Regeln blockieren, aber
 * auch nicht dauerhaft als "geschlossen" gelten.
 */
export function ruleAllows(rule: RuleConditions, ctx: RuleContext): boolean {
  const weekday = tzWeekdayBit(ctx.now, ctx.timezone);
  if (((rule.daysOfWeek >> weekday) & 1) !== 1) return false;

  if (rule.windowStart && rule.windowEnd) {
    if (!isWithinWindow(ctx.now, rule.windowStart, rule.windowEnd, ctx.timezone)) return false;
  }

  if (rule.operating !== "ANY") {
    const open = isOperatingAt(ctx.schedule, ctx.now, ctx.timezone);
    if (rule.operating === "OPEN" && !open) return false;
    if (rule.operating === "CLOSED" && open) return false;
  }

  if (rule.onlyWhenDark && !isDark(ctx)) return false;

  return true;
}

/** Liegt der Zeitpunkt zwischen Sonnenuntergang und Sonnenaufgang? */
export function isDark(ctx: RuleContext): boolean {
  const { sunrise, sunset } = getSunTimesForAccount(ctx.latitude, ctx.longitude, ctx.now);
  if (!sunrise || !sunset) return false;
  return ctx.now < sunrise || ctx.now > sunset;
}

// ─── Laden ────────────────────────────────────────────────────────────────────

/** Regel samt Aktionen und allem, was die Auswertung braucht. */
const ruleInclude = {
  actions: { orderBy: { sortOrder: "asc" as const } },
  account: {
    select: { id: true, timezone: true, latitude: true, longitude: true },
  },
  operatingSchedule: {
    include: {
      seasons: { include: { periods: true }, orderBy: { sortOrder: "asc" as const } },
      exceptions: true,
    },
  },
  room: {
    select: {
      id: true,
      name: true,
      operatingSchedule: {
        include: {
          seasons: { include: { periods: true }, orderBy: { sortOrder: "asc" as const } },
          exceptions: true,
        },
      },
    },
  },
};

type LoadedRule = RoomRule & {
  actions: RoomRuleAction[];
  account: { id: number; timezone: string | null; latitude: number | null; longitude: number | null };
  operatingSchedule: ScheduleRecord | null;
  room: { id: number; name: string; operatingSchedule: ScheduleRecord | null } | null;
};

/**
 * Zustaendige Betriebszeit: die ausdrueckliche der Regel, sonst die des Raums.
 * So kann eine Regel abweichen ("Technik richtet sich nach der Gastronomie"),
 * ohne dass man sie an jeder Regel wiederholen muss.
 */
function scheduleFor(rule: LoadedRule): ScheduleSpec | null {
  const record = rule.operatingSchedule ?? rule.room?.operatingSchedule ?? null;
  return record ? toScheduleSpec(record) : null;
}

function contextFor(rule: LoadedRule, now: Date): RuleContext {
  return {
    now,
    timezone: rule.account.timezone || DEFAULT_TIMEZONE,
    latitude: rule.account.latitude,
    longitude: rule.account.longitude,
    schedule: scheduleFor(rule),
  };
}

/**
 * Sperrt die Regel fuer ihre Cooldown-Dauer und meldet, ob der Aufrufer sie
 * ausfuehren darf. Zwei gleichzeitige Laeufe koennen nicht beide gewinnen,
 * weil der `updateMany` die alte `lastRunAt` in der Bedingung fuehrt.
 */
async function claimRule(ruleId: number, cooldownSeconds: number, now: Date): Promise<boolean> {
  const cooldownMs = Math.max(0, cooldownSeconds) * 1000;
  const claimed = await prisma.roomRule.updateMany({
    where: {
      id: ruleId,
      OR: [{ lastRunAt: null }, { lastRunAt: { lt: new Date(now.getTime() - cooldownMs) } }],
    },
    data: { lastRunAt: now },
  });
  return claimed.count > 0;
}

// ─── Aktionen ─────────────────────────────────────────────────────────────────

async function runDeviceAction(
  rule: LoadedRule,
  action: RoomRuleAction,
  depth: number,
): Promise<ActionResult> {
  const base = { actionId: action.id, kind: "DEVICE" };
  if (!action.deviceId || !action.deviceAction) {
    return { ...base, target: "–", ok: false, error: "Gerät oder Aktion fehlt" };
  }

  const device = await prisma.device.findFirst({
    where: { id: action.deviceId, accountId: rule.accountId },
  });
  if (!device) return { ...base, target: `#${action.deviceId}`, ok: false, error: "Gerät nicht gefunden" };
  if (!device.isActive) {
    return { ...base, target: device.name, ok: false, error: "Gerät ist deaktiviert" };
  }

  try {
    const result = await triggerDeviceAction(
      prisma,
      device,
      rule.accountId,
      action.deviceAction as DeviceAction,
      action.timerSeconds ? { seconds: action.timerSeconds } : {},
    );
    // Folgeregeln erst nach erfolgreichem Schalten, und nur begrenzt tief.
    if (!result.error && depth < MAX_CHAIN_DEPTH) {
      void runDeviceSwitchedRules(
        rule.accountId,
        device.id,
        action.deviceAction,
        depth + 1,
      ).catch(() => {
        /* Folgeregeln sind Beiwerk und duerfen die Hauptaktion nicht kippen. */
      });
    }
    return { ...base, target: device.name, ok: !result.error, error: result.error };
  } catch (e) {
    return { ...base, target: device.name, ok: false, error: (e as Error).message };
  }
}

async function runNotifyAction(rule: LoadedRule, action: RoomRuleAction): Promise<ActionResult> {
  const base = { actionId: action.id, kind: "NOTIFY" };
  const channel = action.channel ?? "PUSH";
  const text =
    action.message?.trim() ||
    `${rule.name}${rule.room ? ` · ${rule.room.name}` : ""}`;

  let sent = 0;
  const errors: string[] = [];

  if (channel === "PUSH" || channel === "BOTH") {
    try {
      const result = await sendPushToAccount(rule.accountId, {
        title: rule.room ? `${rule.room.name}: ${rule.name}` : rule.name,
        body: text,
        url: "/raeume",
        tag: `rule-${rule.id}`,
      });
      sent += result.sent;
      if (result.sent === 0) errors.push("kein Push-Empfänger");
    } catch (e) {
      errors.push(`Push: ${(e as Error).message}`);
    }
  }

  if (channel === "TELEGRAM" || channel === "BOTH") {
    const configs = await prisma.telegramConfig.findMany({
      where: { accountId: rule.accountId, isActive: true },
      select: { botToken: true, chatId: true },
    });
    if (configs.length === 0) errors.push("kein aktiver Telegram-Chat");
    for (const config of configs) {
      try {
        const result = await sendTelegramMessage(config.botToken, config.chatId, text);
        if (result.ok) sent++;
        else errors.push(result.description ?? "Telegram abgelehnt");
      } catch (e) {
        errors.push(`Telegram: ${(e as Error).message}`);
      }
    }
  }

  return {
    ...base,
    target: channel,
    ok: sent > 0,
    error: sent > 0 ? undefined : errors.join("; ") || "nicht zugestellt",
  };
}

async function runAudioAction(rule: LoadedRule, action: RoomRuleAction): Promise<ActionResult> {
  const base = { actionId: action.id, kind: "AUDIO" };
  if (!action.audioZoneId) return { ...base, target: "–", ok: false, error: "Zone fehlt" };

  const zone = await prisma.audioZone.findFirst({
    where: { id: action.audioZoneId, accountId: rule.accountId },
    select: { id: true, name: true, isActive: true, quietFrom: true, quietTo: true },
  });
  if (!zone) return { ...base, target: `#${action.audioZoneId}`, ok: false, error: "Zone nicht gefunden" };
  if (!zone.isActive) return { ...base, target: zone.name, ok: false, error: "Zone ist deaktiviert" };

  // Der Zonen-Pi setzt die Ruhezeit fuer Musik selbst durch. Eine Playlist in
  // der Ruhezeit einzureihen wuerde also nur einen Job erzeugen, der verworfen
  // wird – deshalb hier schon abbrechen. Durchsagen laufen weiterhin.
  const timezone = rule.account.timezone || DEFAULT_TIMEZONE;
  const nowHm = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

  try {
    if (action.audioAnnouncementId) {
      const announcement = await prisma.audioAnnouncement.findFirst({
        where: { id: action.audioAnnouncementId, accountId: rule.accountId },
        include: { track: { select: { id: true, url: true, durationSec: true } } },
      });
      if (!announcement) {
        return { ...base, target: zone.name, ok: false, error: "Durchsage nicht gefunden" };
      }
      const track = await ensureAnnouncementTrack(prisma, rule.accountId, announcement);
      const queued = await queueAnnouncement(
        prisma,
        rule.accountId,
        { ...announcement, track },
        [zone],
        `RULE:${rule.id}`,
      );
      return { ...base, target: `${zone.name} · Durchsage`, ok: queued > 0 };
    }

    if (action.audioPlaylistId) {
      if (isQuietTime(zone.quietFrom, zone.quietTo, nowHm)) {
        return { ...base, target: zone.name, ok: false, error: "Ruhezeit der Zone" };
      }
      const payload = await playlistPayload(prisma, action.audioPlaylistId);
      if (!payload) {
        return { ...base, target: zone.name, ok: false, error: "Playlist ist leer" };
      }
      const queued = await queueZoneCommand(
        prisma,
        rule.accountId,
        [zone],
        "PLAY",
        payload,
        `RULE:${rule.id}`,
      );
      return { ...base, target: `${zone.name} · Playlist`, ok: queued > 0 };
    }

    // Ohne Durchsage und ohne Playlist: Wiedergabe stoppen.
    const queued = await queueZoneCommand(
      prisma,
      rule.accountId,
      [zone],
      "STOP",
      null,
      `RULE:${rule.id}`,
    );
    return { ...base, target: `${zone.name} · Stopp`, ok: queued > 0 };
  } catch (e) {
    return { ...base, target: zone.name, ok: false, error: (e as Error).message };
  }
}

/**
 * Fuehrt alle Aktionen einer Regel aus und schreibt den Verlaufseintrag.
 *
 * Die Aktionen laufen der Reihe nach, nicht parallel: eine Regel kann
 * "Licht an, dann Durchsage" bedeuten, und diese Reihenfolge ist gewollt.
 * Eine fehlgeschlagene Aktion stoppt die uebrigen nicht; `success` ist nur
 * wahr, wenn alle geklappt haben.
 */
export async function executeRule(
  ruleId: number,
  triggerKind: string,
  depth = 0,
): Promise<ExecuteResult> {
  const started = Date.now();
  const rule = (await prisma.roomRule.findUnique({
    where: { id: ruleId },
    include: ruleInclude,
  })) as LoadedRule | null;

  if (!rule) return { success: false, actions: [], durationMs: Date.now() - started };

  const results: ActionResult[] = [];
  for (const action of rule.actions) {
    if (action.kind === "DEVICE") results.push(await runDeviceAction(rule, action, depth));
    else if (action.kind === "NOTIFY") results.push(await runNotifyAction(rule, action));
    else if (action.kind === "AUDIO") results.push(await runAudioAction(rule, action));
  }

  const success = results.length > 0 && results.every((r) => r.ok);
  const durationMs = Date.now() - started;
  const failed = results.filter((r) => !r.ok);

  await prisma.roomRuleRun
    .create({
      data: {
        accountId: rule.accountId,
        ruleId: rule.id,
        ruleName: rule.name,
        roomId: rule.roomId,
        triggerKind,
        success,
        details: results as unknown as Prisma.InputJsonValue,
        durationMs,
        errorMessage: failed.length > 0 ? failed.map((r) => `${r.target}: ${r.error}`).join("; ") : null,
      },
    })
    .catch(() => {
      /* Der Verlauf ist Dokumentation – sein Ausfall darf die Regel nicht kippen. */
    });

  return { success, actions: results, durationMs };
}

// ─── Zeitgesteuerte Ausloeser ─────────────────────────────────────────────────

export interface TickResult {
  checked: number;
  triggered: number;
  results: Array<{ ruleId: number; name: string; trigger: string; success: boolean }>;
}

/** Geplanter Zeitpunkt einer zeitgesteuerten Regel am heutigen Tag. */
function scheduledTimeFor(rule: LoadedRule, ctx: RuleContext): Date | null {
  const ymd = tzYmd(ctx.now, ctx.timezone);

  if (rule.trigger === "TIME") {
    return rule.timeOfDay ? tzInstant(ymd, rule.timeOfDay, ctx.timezone) : null;
  }

  if (rule.trigger === "OPENING" || rule.trigger === "CLOSING") {
    if (!ctx.schedule) return null;
    const wanted = rule.trigger === "OPENING" ? "open" : "close";
    // Bei mehreren Spannen am Tag zaehlt die erste Oeffnung und das letzte
    // Schliessen – "Betriebsbeginn" meint nicht das Ende der Mittagspause.
    const matching = boundariesForDay(ctx.schedule, ymd, ctx.timezone).filter(
      (b) => b.kind === wanted,
    );
    const base = wanted === "open" ? matching[0] : matching[matching.length - 1];
    return base ? new Date(base.at.getTime() + rule.offsetMinutes * 60_000) : null;
  }

  if (rule.trigger === "SUNRISE" || rule.trigger === "SUNSET") {
    const sun = getSunTimesForAccount(ctx.latitude, ctx.longitude, ctx.now);
    const base = rule.trigger === "SUNRISE" ? sun.sunrise : sun.sunset;
    return base ? new Date(base.getTime() + rule.offsetMinutes * 60_000) : null;
  }

  return null;
}

/** Ist der Raum seit `idleMinutes` ohne gemeldete Bewegung? */
async function roomIsIdle(rule: LoadedRule, now: Date): Promise<boolean> {
  if (!rule.roomId || !rule.idleMinutes) return false;
  const since = new Date(now.getTime() - rule.idleMinutes * 60_000);
  const recent = await prisma.cameraEvent.findFirst({
    where: {
      accountId: rule.accountId,
      startedAt: { gte: since },
      camera: { keyRoomId: rule.roomId },
    },
    select: { id: true },
  });
  return recent === null;
}

/**
 * Cron-Durchlauf fuer alles Zeitgesteuerte: feste Uhrzeit, Betriebsbeginn und
 * -ende, Sonnenzeiten und Ruhe im Raum.
 */
export async function runRuleTick(now = new Date()): Promise<TickResult> {
  const timed: RuleTrigger[] = ["TIME", "OPENING", "CLOSING", "SUNRISE", "SUNSET", "IDLE"];
  const rules = (await prisma.roomRule.findMany({
    where: { isActive: true, trigger: { in: timed } },
    include: ruleInclude,
  })) as LoadedRule[];

  const result: TickResult = { checked: rules.length, triggered: 0, results: [] };

  for (const rule of rules) {
    const ctx = contextFor(rule, now);
    if (!ruleAllows(rule, ctx)) continue;

    if (rule.trigger === "IDLE") {
      if (!(await roomIsIdle(rule, now))) continue;
    } else {
      const scheduled = scheduledTimeFor(rule, ctx);
      if (!scheduled) continue;
      if (Math.abs(now.getTime() - scheduled.getTime()) > FIRE_WINDOW_MS) continue;
    }

    // Zeitgesteuerte Regeln duerfen nicht zweimal im selben Fenster feuern,
    // auch wenn die Sperrzeit kuerzer als das Fenster ist.
    const cooldown = Math.max(rule.cooldownSeconds, FIRE_WINDOW_MS / 1000);
    if (!(await claimRule(rule.id, cooldown, now))) continue;

    const executed = await executeRule(rule.id, rule.trigger.toLowerCase());
    result.triggered++;
    result.results.push({
      ruleId: rule.id,
      name: rule.name,
      trigger: rule.trigger,
      success: executed.success,
    });
  }

  return result;
}

// ─── Ereignis-Ausloeser ───────────────────────────────────────────────────────

/**
 * Bewegung, Person oder Fahrzeug im Raum. Wird aus dem Hub-Ingest der
 * Kamera-Ereignisse aufgerufen, sobald ein Ereignis beginnt.
 */
export async function runMotionRules(
  accountId: number,
  cameraId: number,
  eventType: string,
  now = new Date(),
): Promise<{ triggered: number }> {
  const camera = await prisma.camera.findFirst({
    where: { id: cameraId, accountId },
    select: { keyRoomId: true },
  });

  // Zwei unabhaengige Oder-Bedingungen, deshalb ueber AND geschachtelt: als
  // zwei `OR`-Schluessel im selben Objekt wuerde das zweite das erste
  // ueberschreiben, und die Regel wuerde bei jeder Ereignisart feuern.
  const cameraMatch =
    camera?.keyRoomId != null
      ? [{ cameraId }, { cameraId: null, roomId: camera.keyRoomId }]
      : [{ cameraId }];

  const rules = (await prisma.roomRule.findMany({
    where: {
      accountId,
      isActive: true,
      trigger: "MOTION",
      AND: [{ OR: [{ eventType: null }, { eventType }] }, { OR: cameraMatch }],
    },
    include: ruleInclude,
  })) as LoadedRule[];

  let triggered = 0;
  for (const rule of rules) {
    if (rule.eventType && rule.eventType !== eventType) continue;
    if (!ruleAllows(rule, contextFor(rule, now))) continue;
    if (!(await claimRule(rule.id, rule.cooldownSeconds, now))) continue;
    triggered++;
    await executeRule(rule.id, "motion");
  }
  return { triggered };
}

/**
 * Ein Geraet wurde geschaltet. Erkennt nur Befehle aus diesem System – Shelly
 * meldet Zustandswechsel nicht zurueck, und einen gespeicherten Relaiszustand
 * gibt es nicht. `depth` begrenzt Regelketten.
 */
export async function runDeviceSwitchedRules(
  accountId: number,
  deviceId: number,
  action: string,
  depth = 0,
  now = new Date(),
): Promise<{ triggered: number }> {
  if (depth > MAX_CHAIN_DEPTH) return { triggered: 0 };

  const rules = (await prisma.roomRule.findMany({
    where: {
      accountId,
      isActive: true,
      trigger: "DEVICE_SWITCHED",
      triggerDeviceId: deviceId,
      OR: [{ triggerAction: null }, { triggerAction: action }],
    },
    include: ruleInclude,
  })) as LoadedRule[];

  let triggered = 0;
  for (const rule of rules) {
    if (!ruleAllows(rule, contextFor(rule, now))) continue;
    if (!(await claimRule(rule.id, rule.cooldownSeconds, now))) continue;
    triggered++;
    await executeRule(rule.id, "device", depth);
  }
  return { triggered };
}

/**
 * Gewaehrter Zutritt an einem Leser. `areaIds` sind die Bereiche des Lesers,
 * `direction` ist "IN" oder "OUT".
 */
export async function runScanRules(
  accountId: number,
  areaIds: number[],
  direction: "IN" | "OUT",
  now = new Date(),
): Promise<{ triggered: number }> {
  const rules = (await prisma.roomRule.findMany({
    where: {
      accountId,
      isActive: true,
      trigger: "SCAN",
      OR: [{ areaId: null }, ...(areaIds.length > 0 ? [{ areaId: { in: areaIds } }] : [])],
    },
    include: ruleInclude,
  })) as LoadedRule[];

  let triggered = 0;
  for (const rule of rules) {
    if (rule.scanDirection && rule.scanDirection !== direction) continue;
    if (!ruleAllows(rule, contextFor(rule, now))) continue;
    if (!(await claimRule(rule.id, rule.cooldownSeconds, now))) continue;
    triggered++;
    await executeRule(rule.id, "scan");
  }
  return { triggered };
}
