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
import { deviceSendsRemoteCommand, triggerDeviceAction, type DeviceAction } from "@/lib/device-open";
import { deviceActionOutcome } from "@/lib/device-action-log";
import { ruleTimerKind } from "@/lib/rule-timer";
import {
  NOT_ACCEPTED_ERROR,
  ownHubTasks,
  pendingHubTaskIds,
  runOutcome,
  runState,
  sanitizeHubRunDetails,
  settleRunDetails,
  type RunState,
} from "@/lib/rule-run-rules";
import {
  ensureAnnouncementTrack,
  playlistPayload,
  queueAnnouncement,
  queueZoneCommand,
} from "@/lib/audio";
import { musicWindowState } from "@/lib/audio-constants";
import { sendTelegramMessage } from "@/lib/telegram";
import { escapeTelegramHtml } from "@/lib/telegram-text";
import { sendPushToAccount } from "@/lib/web-push";
import { getSunTimesForAccount } from "@/lib/sun";
import { isOperatingAt, openSpansBetween, weekdayName, type ScheduleSpec } from "@/lib/operating-hours";
import { scheduleSpecInclude, toScheduleSpec, type ScheduleRecord } from "@/lib/operating-queries";
import { extendedSpecCache, zoneMusicSpec } from "@/lib/operating-extent-queries";
import {
  DEFAULT_TIMEZONE,
  formatHhmm,
  isWithinWindow,
  tzMinutesOfDay,
  tzYmd,
  weekdayBitOfYmd,
  windowWeekday,
} from "@/lib/tz-time";
import { OPEN_EVENT_MAX_AGE_MS, activityAt } from "@/lib/camera-events";
import {
  CLOSING_NET_AFTER_MS,
  RULE_CATCH_UP_MS,
  RULE_LEGACY_WINDOW_MS,
  RULE_RUN_LOCK_MS,
  actionKeys,
  closingNetDue,
  closingNetSince,
  hubFireMatches,
  hubRunAnnounced,
  hubRunScope,
  hubRunsLocally,
  idleActivityTypes,
  idleDue,
  isHubLocalKind,
  isTimedTrigger,
  lastOccurrenceAfter,
  missedDecision,
  nextDueStep,
  occurrencesAround,
  occurrencesBetween,
  pairedCloseDevices,
  readHubRulesReport,
  rowTouchesDevices,
  summarizeAttempts,
  type AttemptRow,
  type HubRuleState,
  type HubRunScope,
  type OccurrenceEnv,
  type RuleOccurrence,
  type TimedRuleSpec,
} from "@/lib/rule-due";
import { conditionChangePoints, exactIntervals, rasterIntervals, type PlanInterval } from "@/lib/rule-plan";
import { decideExecutor, type ExecutorContext } from "@/lib/rule-executor";

export type { PlanInterval } from "@/lib/rule-plan";

/** Mindest-Sperre fuer Ruhe-Regeln. Der Cron laeuft alle fuenf Minuten. */
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
  /**
   * Betriebstag "YYYY-MM-TT" eines Termins „Betriebsbeginn“ bzw.
   * „Betriebsende“: Die Wochentage der Regel gelten fuer ihn, auch wenn das
   * Betriebsende nach Mitternacht liegt.
   */
  operatingDay?: string;
}

export interface ActionResult {
  actionId: number;
  kind: string;
  target: string;
  ok: boolean;
  error?: string;
  /**
   * Schluessel der Aktion, der ein Speichern der Regel uebersteht
   * (`actionKeys` in rule-due.ts): Daran erkennt ein spaeterer Versuch zum
   * selben Termin, was schon gelungen ist.
   */
  key?: string;
  /** DEVICE: Geraet und Befehl, fuer das Sicherheitsnetz zum Betriebsende. */
  deviceId?: number;
  deviceAction?: string;
  /**
   * An den Hub uebergeben (Hue, Kamera): Auftragsnummer. Solange `pending`
   * gilt, steht das Ergebnis aus; die Ergebnis-Route des Auftrags traegt es
   * nach (`settleHubHandovers`). Fuer den Termin einer Zeit-Regel zaehlt die
   * Aktion damit als gelaufen.
   */
  hubTaskId?: number;
  pending?: boolean;
  /** Dauer dieser Aktion in Millisekunden (Messpunkt fuer „Ereignis bis Schalten“). */
  ms?: number;
}

/**
 * Hat das Geraet den Befehl angenommen? Kein Fehlertext und, bei Geraeten mit
 * Fernbefehl (Shelly, Nuki, LOQED, GARDENA, Hue), `sent`. Ein Pi holt seinen
 * Auftrag selbst ab; dort zaehlt nur ein Fehlertext (`deviceActionOutcome`).
 */
export function actionSucceeded(deviceType: string, result: { sent: boolean; error?: string }): boolean {
  return deviceActionOutcome(deviceSendsRemoteCommand(deviceType), result) === "ok";
}

/**
 * Optionen fuer `triggerDeviceAction` aus der Selbstabschaltung einer
 * Regel-Aktion: GARDENA bekommt die Laufzeit (`seconds`), Shelly-Schalter und
 * -Beleuchtung beim Einschalten den Timer im Geraet (`autoOffSec`). Bei allen
 * anderen Geraeten und Befehlen bleibt es beim Standard des Geraets
 * (rule-timer.ts, `ruleTimerKind`).
 */
export function triggerOptionsFor(
  device: { type: string; category?: string | null },
  timerSeconds: number | null | undefined,
  action: string,
): { seconds?: number; autoOffSec?: number } {
  if (timerSeconds == null || !Number.isFinite(timerSeconds) || timerSeconds <= 0) return {};
  const kind = ruleTimerKind(device, action);
  if (kind === "seconds") return { seconds: timerSeconds };
  if (kind === "autoOffSec") return { autoOffSec: timerSeconds };
  return {};
}

export interface ExecuteResult {
  success: boolean;
  actions: ActionResult[];
  durationMs: number;
}

/** Ausgeloeste Regel, wie sie die Ereignis-Meldung des Hubs zurueckbekommt. */
export interface TriggeredRuleRun {
  ruleId: number;
  name: string;
  /** Wie auf der Regel-Seite: erledigt, an den Hub uebergeben oder gescheitert. */
  state: RunState;
  /** Dauer des Laufs in der Cloud (Regel laden bis letzte Aktion). */
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
 * Wochentage: Bei einem Zeitfenster ueber Mitternacht gilt der Tag, an dem
 * die Nacht beginnt („nur Samstag, 22–8 Uhr“ heisst Samstag 22 Uhr bis
 * Sonntag 8 Uhr, `windowWeekday`). Bei Terminen zum Betriebsbeginn und
 * -ende gilt der Betriebstag (`ctx.operatingDay`).
 *
 * Wichtig fuer die Betriebszeit-Bedingung: ist keine Betriebszeit zustaendig,
 * gilt `OPEN` als erfuellt und `CLOSED` als nicht erfuellt. Ein Raum ohne
 * gepflegtes Profil soll nicht stillschweigend alle Regeln blockieren, aber
 * auch nicht dauerhaft als "geschlossen" gelten.
 */
export function ruleAllows(rule: RuleConditions, ctx: RuleContext): boolean {
  const weekday = ctx.operatingDay
    ? weekdayBitOfYmd(ctx.operatingDay)
    : windowWeekday(ctx.now, rule.windowStart, rule.windowEnd, ctx.timezone);
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
      operatingScheduleId: true,
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
  room: { id: number; name: string; operatingScheduleId: number | null; operatingSchedule: ScheduleRecord | null } | null;
  /**
   * Betriebszeit samt Bahnmieten und Kursen, wenn die Regel sie mitnimmt
   * (`operatingExtent`); vorab geladen von `withExtendedSpecs`.
   */
  extendedSpec?: ScheduleSpec | null;
};

/**
 * Regeln, die auch zu Bahnmieten und Kursen laufen, bekommen ihre erweiterte
 * Betriebszeit vorab: `scheduleFor` bleibt so synchron. Ohne solche Regeln
 * kostet das keine Abfrage.
 */
async function withExtendedSpecs<T extends LoadedRule>(rules: T[], now: Date): Promise<T[]> {
  const extended = rules.filter((r) => r.operatingExtent !== "SELF");
  if (extended.length === 0) return rules;
  const load = extendedSpecCache(prisma, now);
  for (const rule of extended) {
    const scheduleId = rule.operatingScheduleId ?? rule.room?.operatingScheduleId ?? null;
    if (scheduleId == null) continue;
    rule.extendedSpec = await load(rule.accountId, scheduleId, rule.operatingExtent, rule.account.timezone);
  }
  return rules;
}

/**
 * Zustaendige Betriebszeit: die ausdrueckliche der Regel, sonst die des Raums.
 * So kann eine Regel abweichen ("Technik richtet sich nach der Gastronomie"),
 * ohne dass man sie an jeder Regel wiederholen muss.
 */
function scheduleFor(rule: LoadedRule): ScheduleSpec | null {
  if (rule.extendedSpec !== undefined) return rule.extendedSpec;
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

/** Geschaltetes Geraet, dessen Regeln „Geraet geschaltet“ nach dem Lauf starten. */
interface FollowUp {
  deviceId: number;
  action: string;
}

async function runDeviceAction(
  rule: LoadedRule,
  action: RoomRuleAction,
  depth: number,
  followUps: FollowUp[],
): Promise<ActionResult> {
  const base = {
    actionId: action.id,
    kind: "DEVICE",
    ...(action.deviceId ? { deviceId: action.deviceId } : {}),
    ...(action.deviceAction ? { deviceAction: action.deviceAction } : {}),
  };
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
      {
        ...triggerOptionsFor(device, action.timerSeconds, action.deviceAction),
        actor: { source: "regel", actorLabel: `regel:${rule.id}` },
        ruleId: rule.id,
        ...(depth < MAX_CHAIN_DEPTH ? { switched: { action: action.deviceAction, depth: depth + 1 } } : {}),
      },
    );
    const ok = actionSucceeded(device.type, result);
    // Folgeregeln erst nach erfolgreichem Schalten, und nur begrenzt tief.
    // executeRule startet sie nach den eigenen Aktionen und wartet auf sie.
    // An den Hub uebergeben (Hue): Sie starten mit seinem Ergebnis
    // (Ergebnis-Route des Auftrags, `switchedFollowUp`).
    if (ok && result.hubTaskId == null && depth < MAX_CHAIN_DEPTH) {
      followUps.push({ deviceId: device.id, action: action.deviceAction });
    }
    if (ok && result.hubTaskId != null) {
      return { ...base, target: device.name, ok: false, pending: true, hubTaskId: result.hubTaskId };
    }
    return ok
      ? { ...base, target: device.name, ok: true }
      : { ...base, target: device.name, ok: false, error: result.error || NOT_ACCEPTED_ERROR };
  } catch (e) {
    return { ...base, target: device.name, ok: false, error: (e as Error).message };
  }
}

/**
 * Zustellweg der Aktion „Benachrichtigen“: Push an alle Push-Empfaenger des
 * Mandanten, Telegram an alle aktiven Telegram-Chats des Mandanten.
 */
async function deliverRuleNotice(
  accountId: number,
  channel: string,
  notice: { title: string; body: string; tag: string },
): Promise<{ sent: number; error?: string }> {
  let sent = 0;
  const errors: string[] = [];

  if (channel === "PUSH" || channel === "BOTH") {
    try {
      const result = await sendPushToAccount(accountId, {
        title: notice.title,
        body: notice.body,
        url: "/raeume",
        tag: notice.tag,
      });
      sent += result.sent;
      if (result.sent === 0) errors.push("kein Push-Empfänger");
    } catch (e) {
      errors.push(`Push: ${(e as Error).message}`);
    }
  }

  if (channel === "TELEGRAM" || channel === "BOTH") {
    const configs = await prisma.telegramConfig.findMany({
      where: { accountId, isActive: true },
      select: { botToken: true, chatId: true },
    });
    if (configs.length === 0) errors.push("kein aktiver Telegram-Chat");
    for (const config of configs) {
      try {
        const result = await sendTelegramMessage(config.botToken, config.chatId, escapeTelegramHtml(notice.body));
        if (result.ok) sent++;
        else errors.push(result.description ?? "Telegram abgelehnt");
      } catch (e) {
        errors.push(`Telegram: ${(e as Error).message}`);
      }
    }
  }

  return sent > 0 ? { sent } : { sent, error: errors.join("; ") || "nicht zugestellt" };
}

async function runNotifyAction(rule: LoadedRule, action: RoomRuleAction): Promise<ActionResult> {
  const base = { actionId: action.id, kind: "NOTIFY" };
  const channel = action.channel ?? "PUSH";
  const text =
    action.message?.trim() ||
    `${rule.name}${rule.room ? ` · ${rule.room.name}` : ""}`;

  const delivered = await deliverRuleNotice(rule.accountId, channel, {
    title: rule.room ? `${rule.room.name}: ${rule.name}` : rule.name,
    body: text,
    tag: `rule-${rule.id}`,
  });

  return {
    ...base,
    target: channel,
    ok: delivered.sent > 0,
    error: delivered.error,
  };
}

/**
 * Kamera steuern: der Hub faehrt das Preset an und schaltet „automatisch
 * folgen“ (Reolink Auto-Tracking). Laeuft als Hub-Task, weil nur der Hub die
 * Kamera im LAN erreicht; der Hub holt Tasks nach einem Ereignis sofort ab.
 */
async function runCameraAction(rule: LoadedRule, action: RoomRuleAction): Promise<ActionResult> {
  const base = { actionId: action.id, kind: "CAMERA" };
  if (!action.targetCameraId) return { ...base, target: "–", ok: false, error: "Kamera fehlt" };
  const camera = await prisma.camera.findFirst({
    where: { id: action.targetCameraId, accountId: rule.accountId },
    select: { id: true, name: true, enabled: true },
  });
  if (!camera) return { ...base, target: `#${action.targetCameraId}`, ok: false, error: "Kamera nicht gefunden" };
  if (!camera.enabled) return { ...base, target: camera.name, ok: false, error: "Kamera ist deaktiviert" };

  const parts = [
    action.ptzPresetId != null ? `Preset ${action.ptzPresetId}` : null,
    action.autoTrack == null ? null : action.autoTrack ? "folgen an" : "folgen aus",
  ].filter(Boolean);
  try {
    const task = await prisma.hubTask.create({
      data: {
        accountId: rule.accountId,
        type: "CAMERA_SCENE",
        payload: {
          cameraId: camera.id,
          presetId: action.ptzPresetId,
          autoTrack: action.autoTrack,
          returnAfterSeconds: action.returnAfterSeconds,
          ruleId: rule.id,
        },
      },
      select: { id: true },
    });
    // An den Hub uebergeben: Das Ergebnis traegt die Ergebnis-Route nach.
    return { ...base, target: `${camera.name} · ${parts.join(", ")}`, ok: false, pending: true, hubTaskId: task.id };
  } catch (e) {
    return { ...base, target: camera.name, ok: false, error: (e as Error).message };
  }
}

async function runAudioAction(rule: LoadedRule, action: RoomRuleAction): Promise<ActionResult> {
  const base = { actionId: action.id, kind: "AUDIO" };
  if (!action.audioZoneId) return { ...base, target: "–", ok: false, error: "Zone fehlt" };

  const zone = await prisma.audioZone.findFirst({
    where: { id: action.audioZoneId, accountId: rule.accountId },
    select: {
      id: true,
      name: true,
      isActive: true,
      musicMode: true,
      musicTimes: true,
      musicOpenOffset: true,
      musicCloseOffset: true,
      musicOverrideUntil: true,
      musicExtent: true,
      keyRoom: { select: { operatingScheduleId: true, operatingSchedule: { include: scheduleSpecInclude } } },
    },
  });
  if (!zone) return { ...base, target: `#${action.audioZoneId}`, ok: false, error: "Zone nicht gefunden" };
  if (!zone.isActive) return { ...base, target: zone.name, ok: false, error: "Zone ist deaktiviert" };

  // Der Zonen-Pi haelt das Musikfenster (eigene Musikzeiten oder Betriebszeit
  // des Raums samt Versatz) selbst ein. Eine Playlist ausserhalb einzureihen wuerde also nur einen
  // Job erzeugen, der verworfen wird – deshalb hier schon abbrechen.
  // Durchsagen laufen weiterhin.
  const timezone = rule.account.timezone || DEFAULT_TIMEZONE;
  const operating = zone.keyRoom?.operatingSchedule;
  const musicAllowed = musicWindowState(
    zone,
    await zoneMusicSpec(prisma, rule.accountId, zone, new Date(), timezone),
    new Date(),
    timezone,
  ).allowed;

  try {
    if (action.audioAnnouncementId) {
      const announcement = await prisma.audioAnnouncement.findFirst({
        where: { id: action.audioAnnouncementId, accountId: rule.accountId },
        include: { track: { select: { id: true, url: true, durationSec: true } } },
      });
      if (!announcement) {
        return { ...base, target: zone.name, ok: false, error: "Durchsage nicht gefunden" };
      }
      const track = await ensureAnnouncementTrack(prisma, rule.accountId, announcement, {
        now: new Date(),
        timezone,
        schedule: operating ? toScheduleSpec(operating) : scheduleFor(rule),
      });
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
      if (!musicAllowed) {
        return { ...base, target: zone.name, ok: false, error: "Außerhalb der Musikzeit der Zone" };
      }
      const payload = await playlistPayload(prisma, rule.accountId, action.audioPlaylistId);
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

export interface ExecuteOptions {
  /** Tiefe in einer Regelkette (Folgeregeln). */
  depth?: number;
  /**
   * Aktionen mit diesen Schluesseln auslassen: Sie sind fuer den Termin schon
   * gelungen oder werden gerade zurueckgehalten (`actionKeys`).
   */
  skipKeys?: Set<string>;
  /** Nur diese Aktionen ausfuehren (Sicherheitsnetz: Schliessen bestimmter Geraete). */
  onlyActions?: (action: RoomRuleAction) => boolean;
  /**
   * Zeit des ausloesenden Ereignisses (Kamera-Ereignis, Schaltvorgang, Scan)
   * bzw. Soll-Zeit des Termins; steht als `eventAt` im Verlauf. Zusammen mit
   * `startedAt` und dem Ende (`triggeredAt`) ist „Ereignis bis Schalten“
   * per SQL ablesbar.
   */
  eventAt?: Date | null;
}

/**
 * Fuehrt alle Aktionen einer Regel aus und schreibt den Verlaufseintrag.
 *
 * Die Aktionen laufen der Reihe nach, nicht parallel: eine Regel kann
 * "Licht an, dann Durchsage" bedeuten, und diese Reihenfolge ist gewollt.
 * Eine fehlgeschlagene Aktion stoppt die uebrigen nicht; `success` ist nur
 * wahr, wenn alle geklappt haben. Ein Nachhol-Versuch fuehrt nur die
 * Aktionen aus, die fuer den Termin noch ausstehen (`skipKeys`), und steht
 * als eigene Zeile im Verlauf. Bleibt keine Aktion uebrig, entsteht keine
 * Zeile.
 */
export async function executeRule(
  ruleId: number,
  triggerKind: string,
  options: ExecuteOptions | number = {},
): Promise<ExecuteResult> {
  const opts: ExecuteOptions = typeof options === "number" ? { depth: options } : options;
  const depth = opts.depth ?? 0;
  const started = Date.now();
  const rule = (await prisma.roomRule.findUnique({
    where: { id: ruleId },
    include: ruleInclude,
  })) as LoadedRule | null;

  if (!rule) return { success: false, actions: [], durationMs: Date.now() - started };
  await withExtendedSpecs([rule], new Date());

  const keys = actionKeys(rule.actions);
  const toRun = rule.actions.filter((action) => {
    const key = keys.get(action.id);
    if (key && opts.skipKeys?.has(key)) return false;
    return opts.onlyActions ? opts.onlyActions(action) : true;
  });
  if (toRun.length === 0 && (opts.skipKeys || opts.onlyActions)) {
    return { success: true, actions: [], durationMs: Date.now() - started };
  }

  const results: ActionResult[] = [];
  const followUps: FollowUp[] = [];
  for (const action of toRun) {
    const actionStarted = Date.now();
    let result: ActionResult | null = null;
    if (action.kind === "DEVICE") result = await runDeviceAction(rule, action, depth, followUps);
    else if (action.kind === "NOTIFY") result = await runNotifyAction(rule, action);
    else if (action.kind === "AUDIO") result = await runAudioAction(rule, action);
    else if (action.kind === "CAMERA") result = await runCameraAction(rule, action);
    if (result) results.push({ ...result, key: keys.get(action.id), ms: Date.now() - actionStarted });
  }

  // Erfolg nur, wenn jede Aktion gelang; an den Hub uebergebene Aktionen
  // zaehlen erst mit seinem Ergebnis (rule-run-rules.ts, runOutcome).
  const { success, errorMessage } = runOutcome(results);
  const durationMs = Date.now() - started;

  const created = await prisma.roomRuleRun
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
        errorMessage,
        startedAt: new Date(started),
        ...(opts.eventAt ? { eventAt: opts.eventAt } : {}),
      },
      select: { id: true },
    })
    .catch(() => {
      /* Der Verlauf ist Dokumentation – sein Ausfall darf die Regel nicht kippen. */
      return null;
    });

  // Hat der Hub schon geantwortet, bevor der Lauf geschrieben war, findet
  // die Ergebnis-Route ihn nicht: dann gleich hier nachtragen.
  if (created && results.some((r) => r.pending)) {
    await settleHubHandovers(rule.accountId, { runIds: [created.id] }).catch((e) => {
      console.error(`[room-rules] Hub-Ergebnis fuer Lauf ${created.id} nicht nachgetragen:`, (e as Error).message);
    });
  }

  // Folgeregeln („Geraet geschaltet“) erst nach den eigenen Aktionen und dem
  // eigenen Verlaufseintrag, und abgewartet: Die Plattform friert eine
  // Funktion nach der Antwort ein, offene Arbeit liefe sonst verspaetet oder
  // gar nicht. Ein Fehler dort kippt den Lauf nicht.
  for (const f of followUps) {
    await runDeviceSwitchedRules(rule.accountId, f.deviceId, f.action, depth + 1).catch((e) => {
      console.error(`[room-rules] Folgeregeln von Regel ${rule.id} fehlgeschlagen:`, (e as Error).message);
    });
  }

  return { success, actions: results, durationMs };
}

/** So lange nach einem Lauf gleicht der Cron offene Hub-Auftraege noch ab (Auftraege verfallen nach 24 h). */
const HANDOVER_SWEEP_MS = 26 * 3_600_000;

/**
 * An den Hub uebergebene Aktionen mit dem Stand ihrer Auftraege abgleichen
 * und den Lauf nachtragen (Erfolg, Fehlertext). Aufgerufen von der
 * Ergebnis-Route des Auftrags (`hubTaskId`), von `executeRule` direkt nach
 * dem Schreiben (`runIds`) und vom Cron fuer verfallene Auftraege, die die
 * Abholung oder die Datenpflege per updateMany auf FAILED setzt. Mehrfaches
 * Abgleichen ist unschaedlich. Jede Abfrage bleibt im Mandanten; der Cron
 * gleicht Mandant fuer Mandant ab (`settleAllHubHandovers`).
 */
export async function settleHubHandovers(
  accountId: number,
  scope: { runIds?: number[]; hubTaskId?: number; ruleId?: number | null } = {},
  now = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - HANDOVER_SWEEP_MS);
  const rows = await prisma.roomRuleRun.findMany({
    where: {
      accountId,
      success: false,
      triggeredAt: { gte: since },
      ...(scope.runIds ? { id: { in: scope.runIds } } : {}),
      ...(scope.ruleId ? { ruleId: scope.ruleId } : {}),
      // Cron ohne Eingrenzung: nur Laeufe, die ausser offenen Auftraegen
      // nichts Gescheitertes haben (runOutcome laesst dann den Fehlertext leer).
      ...(!scope.runIds && scope.hubTaskId == null ? { errorMessage: null } : {}),
    },
    select: { id: true, accountId: true, details: true },
    orderBy: { triggeredAt: "desc" },
    take: 200,
  });
  const open = rows
    .map((r) => ({ ...r, taskIds: pendingHubTaskIds(r.details) }))
    .filter((r) => r.taskIds.length > 0 && (scope.hubTaskId == null || r.taskIds.includes(scope.hubTaskId)));
  if (open.length === 0) return 0;

  const tasks = await prisma.hubTask.findMany({
    where: { accountId, id: { in: [...new Set(open.flatMap((r) => r.taskIds))] } },
    select: { id: true, accountId: true, status: true, error: true },
  });
  // Je Lauf nur Auftraege seines Mandanten, auch wenn eine Abfrage mehr liefert.
  const own = ownHubTasks(tasks, accountId);

  let settled = 0;
  for (const row of open) {
    if (row.accountId !== accountId) continue;
    const { details, changed } = settleRunDetails(row.details, own);
    if (!changed) continue;
    const { success, errorMessage } = runOutcome(details);
    await prisma.roomRuleRun.update({
      where: { id: row.id, accountId },
      data: { details: details as unknown as Prisma.InputJsonValue, success, errorMessage },
    });
    settled++;
  }
  return settled;
}

/**
 * Cron: verfallene Hub-Auftraege Mandant fuer Mandant nachtragen. Jeder
 * Mandant, wie in `runRuleTick`, auch einer, der nicht aktiv ist: Seine
 * Regeln laufen dort weiter, und ihre Laeufe blieben sonst offen. Ein
 * Mandant, bei dem das scheitert, haelt die uebrigen nicht auf.
 */
export async function settleAllHubHandovers(now = new Date()): Promise<number> {
  const accounts = await prisma.account.findMany({ select: { id: true } });
  let settled = 0;
  for (const account of accounts) {
    try {
      settled += await settleHubHandovers(account.id, {}, now);
    } catch (e) {
      console.error(`[room-rules] Hub-Ergebnisse fuer Mandant ${account.id} nicht nachgetragen:`, (e as Error).message);
    }
  }
  return settled;
}

// ─── Zeitgesteuerte Ausloeser ─────────────────────────────────────────────────

export interface TickResult {
  checked: number;
  triggered: number;
  results: Array<{
    ruleId: number;
    name: string;
    trigger: string;
    success: boolean;
    /** Zeit-Regeln: Soll-Zeit des Termins und Art des Laufs. */
    occurrenceAt?: string;
    kind?: "termin" | "nachgeholt" | "verpasst" | "netz";
  }>;
}

/** Zeitzone, Standort und Betriebszeit einer Regel fuer die Termin-Rechnung. */
function occurrenceEnv(rule: LoadedRule, now: Date): OccurrenceEnv {
  const ctx = contextFor(rule, now);
  return { timezone: ctx.timezone, latitude: ctx.latitude, longitude: ctx.longitude, schedule: ctx.schedule };
}

/**
 * Nur die Termine, deren Bedingungen zur Soll-Zeit erfuellt sind (Wochentag,
 * Zeitfenster, Betriebszeit, Dunkelheit). Ein Termin bleibt damit derselbe,
 * auch wenn er erst spaeter nachgeholt wird. Cron-Lauf und Plan fuer den Hub
 * filtern beide hiermit. Fuer Betriebsbeginn und -ende zaehlt der
 * Wochentag des Betriebstags.
 */
export function allowedOccurrences(
  rule: RuleConditions & { trigger: string },
  env: OccurrenceEnv,
  occurrences: RuleOccurrence[],
): RuleOccurrence[] {
  const byOperatingDay = rule.trigger === "OPENING" || rule.trigger === "CLOSING";
  return occurrences.filter((o) =>
    ruleAllows(rule, { ...env, now: o.at, ...(byOperatingDay ? { operatingDay: o.ymd } : {}) }),
  );
}

/** Termine einer Zeit-Regel rund um `now`, Bedingungen erfuellt. */
function timedOccurrences(rule: LoadedRule, now: Date): RuleOccurrence[] {
  const env = occurrenceEnv(rule, now);
  return allowedOccurrences(rule, env, occurrencesAround(rule, env, now));
}

/**
 * Laeufe der Regel mit eigenem Ausloeser (auch vom Hub gemeldet) zu einem
 * Termin: ab Soll-Zeit minus `RULE_LEGACY_WINDOW_MS` bis kurz nach Fristende
 * (ein Versuch kurz vor Fristende schreibt seine Zeile erst danach).
 */
async function attemptsFor(
  rule: { id: number; accountId: number; trigger: string },
  occ: RuleOccurrence,
): Promise<Array<AttemptRow & { id: number }>> {
  const kind = rule.trigger.toLowerCase();
  return prisma.roomRuleRun.findMany({
    where: {
      accountId: rule.accountId,
      ruleId: rule.id,
      triggerKind: { in: [kind, `hub:${kind}`] },
      triggeredAt: {
        gte: new Date(occ.at.getTime() - RULE_LEGACY_WINDOW_MS),
        lt: new Date(occ.until.getTime() + RULE_RUN_LOCK_MS),
      },
    },
    select: { id: true, triggerKind: true, triggeredAt: true, success: true, details: true, errorMessage: true },
    orderBy: { triggeredAt: "asc" },
    take: 50,
  });
}

/**
 * Laeufe zu einem Termin, offene Hub-Auftraege vorher abgeglichen: Ein
 * Auftrag, der inzwischen gescheitert oder verfallen ist, steht sonst noch
 * als „in Arbeit“ im Lauf. Der Cron-Abgleich aller Mandanten nimmt nur Laeufe
 * ohne andere Fehler (`settleHubHandovers`); hier zaehlt jeder Lauf des Termins.
 */
async function settledAttemptsFor(rule: LoadedRule, occ: RuleOccurrence, now: Date): Promise<AttemptRow[]> {
  const rows = await attemptsFor(rule, occ);
  const open = rows.filter((r) => pendingHubTaskIds(r.details).length > 0).map((r) => r.id);
  if (open.length === 0) return rows;
  const settled = await settleHubHandovers(rule.accountId, { runIds: open }, now).catch((e) => {
    console.error(`[room-rules] Hub-Ergebnisse fuer Regel ${rule.id} nicht abgeglichen:`, (e as Error).message);
    return 0;
  });
  return settled > 0 ? attemptsFor(rule, occ) : rows;
}

/** Termin als gelaufen vermerken; ein spaeterer Vermerk bleibt stehen. */
async function markOccurrence(accountId: number, ruleId: number, at: Date): Promise<void> {
  await prisma.roomRule.updateMany({
    where: { id: ruleId, accountId, OR: [{ lastOccurrenceAt: null }, { lastOccurrenceAt: { lt: at } }] },
    data: { lastOccurrenceAt: at },
  });
}

/** "Sa 22.11. 18:30" in der Zeitzone des Betriebs. */
function describeOccurrenceAt(at: Date, tz: string): string {
  const ymd = tzYmd(at, tz);
  const [, mm, dd] = ymd.split("-");
  return `${weekdayName(weekdayBitOfYmd(ymd))} ${dd}.${mm}. ${formatHhmm(tzMinutesOfDay(at, tz))}`;
}

/** Was die Cloud vom Hub des Mandanten weiss (juengstes Lebenszeichen). */
async function loadHubState(accountId: number): Promise<HubRuleState | null> {
  const hub = await prisma.hubAgent.findFirst({
    where: { accountId },
    orderBy: { lastSeenAt: { sort: "desc", nulls: "last" } },
    select: { lastSeenAt: true, status: true },
  });
  if (!hub) return null;
  return {
    lastSeenAt: hub.lastSeenAt,
    rules: readHubRulesReport((hub.status as { rules?: unknown } | null)?.rules),
  };
}

/**
 * Schluessel der Aktionen, die der Hub im Notbetrieb selbst schaltet; „zu“
 * an einem Rolltor nur, wenn er das laut Lebenszeichen tut (`coverClose`).
 * Hat er einen Termin angekuendigt, holt die Cloud diese Aktionen nicht nach,
 * sondern wartet auf seinen Lauf (rule-due.ts, `hubRunAnnounced`). `scope`
 * „safe“: Termin kurz vor seinem letzten Kontakt, davon nur Aus und Zu
 * (rule-due.ts, `hubRunScope`).
 */
async function hubLocalKeys(rule: LoadedRule, hub: HubRuleState | null, scope: HubRunScope = "all"): Promise<Set<string>> {
  const safeOnly = scope === "safe";
  const coverClose = hub?.rules?.coverClose === true;
  const keys = actionKeys(rule.actions);
  const deviceIds = rule.actions.filter((a) => a.kind === "DEVICE" && a.deviceId).map((a) => a.deviceId as number);
  const devices = deviceIds.length
    ? await prisma.device.findMany({
        where: { id: { in: deviceIds }, accountId: rule.accountId },
        select: { id: true, type: true, category: true, ipAddress: true, hueBridgeId: true, hueLightId: true },
      })
    : [];
  const byId = new Map(devices.map((d) => [d.id, d]));
  const out = new Set<string>();
  for (const a of rule.actions) {
    const key = keys.get(a.id);
    if (!key) continue;
    if (isHubLocalKind(a.kind, safeOnly)) out.add(key);
    const device = a.deviceId ? byId.get(a.deviceId) : undefined;
    if (a.kind === "DEVICE" && device && a.deviceAction && hubRunsLocally(device, a.deviceAction, coverClose, safeOnly)) out.add(key);
  }
  return out;
}

/**
 * Frist abgelaufen, Termin nicht gelaufen: genau eine Meldung ueber den Weg
 * der Aktion „Benachrichtigen“ (Kanal der ersten Benachrichtigung der Regel,
 * sonst Push und Telegram). Der Vermerk `lastMissedAt` wird vorher mit
 * Bedingung gesetzt, sodass zwei Cron-Laeufe nicht beide melden; laeuft
 * gerade ein Versuch (Sperre), meldet erst der naechste Lauf.
 *
 * `hubSilentSince`: Die Meldung ging erst nach der Wartezeit auf den Hub
 * hinaus (rule-due.ts, `missedDecision`), dessen Ergebnis noch aussteht. Sie
 * sagt dann „nicht bestaetigt“ statt „nicht ausgefuehrt“ und nur, dass der
 * Hub geschaltet haben kann: Ob er es tat, steht erst mit seinem Lauf fest.
 */
async function reportMissed(
  rule: LoadedRule,
  occ: RuleOccurrence,
  attempts: { attempts: number; lastError: string | null; pendingKeys?: Set<string> },
  now: Date,
  hubSilentSince?: Date | null,
): Promise<boolean> {
  const claimed = await prisma.roomRule.updateMany({
    where: {
      id: rule.id,
      accountId: rule.accountId,
      AND: [
        { OR: [{ lastMissedAt: null }, { lastMissedAt: { lt: occ.at } }] },
        { OR: [{ lastRunAt: null }, { lastRunAt: { lt: new Date(now.getTime() - RULE_RUN_LOCK_MS) } }] },
      ],
    },
    data: { lastMissedAt: occ.at },
  });
  if (claimed.count === 0) return false;

  const tz = rule.account.timezone || DEFAULT_TIMEZONE;
  const when = describeOccurrenceAt(occ.at, tz);
  const minutes = Math.round(RULE_CATCH_UP_MS / 60_000);
  // An den Hub uebergeben, bis Fristende ohne Ergebnis (Hub holt nicht ab).
  const open = attempts.pendingKeys?.size ?? 0;
  const openText = open === 0 ? null : open === 1 ? "Ein Hub-Auftrag blieb bis Fristende ohne Ergebnis." : `${open} Hub-Aufträge blieben bis Fristende ohne Ergebnis.`;
  const cloudReason =
    attempts.attempts === 0
      ? `Kein Lauf in den ${minutes} Minuten nach der Soll-Zeit.`
      : [
          `${attempts.attempts} ${attempts.attempts === 1 ? "Versuch" : "Versuche"} in ${minutes} Minuten.`,
          attempts.lastError || !openText ? `Letzter Fehler: ${attempts.lastError ?? "unbekannt"}` : null,
          openText,
        ]
          .filter(Boolean)
          .join(" ");
  const unconfirmed = hubSilentSince !== undefined;
  const reason = unconfirmed
    ? `${cloudReason} Vom Hub kam ${hubSilentSince ? `seit ${describeOccurrenceAt(hubSilentSince, tz)} ` : ""}kein Lebenszeichen; er kann den Termin im Notbetrieb selbst geschaltet haben. Ob und mit welchem Ergebnis, meldet er nach seiner Rückkehr.`
    : cloudReason;
  const title = rule.room ? `${rule.room.name}: ${rule.name}` : rule.name;
  const body = `Regel „${rule.name}“ ${unconfirmed ? "nicht bestätigt" : "nicht ausgeführt"} (Termin ${when}). ${reason}`;
  const channel = rule.actions.find((a) => a.kind === "NOTIFY")?.channel ?? "BOTH";
  const delivered = await deliverRuleNotice(rule.accountId, channel, { title, body, tag: `rule-${rule.id}-missed` });

  await prisma.roomRuleRun
    .create({
      data: {
        accountId: rule.accountId,
        ruleId: rule.id,
        ruleName: rule.name,
        roomId: rule.roomId,
        triggerKind: "missed",
        success: false,
        details: [
          { actionId: 0, kind: "NOTIFY", target: channel, ok: delivered.sent > 0, error: delivered.error, occurrenceAt: occ.at.toISOString() },
        ] as unknown as Prisma.InputJsonValue,
        errorMessage: `Termin ${when} ${unconfirmed ? "nicht bestätigt" : "nicht ausgeführt"}. ${reason}`.slice(0, 1000),
      },
    })
    .catch(() => {
      /* Der Verlauf ist Dokumentation – sein Ausfall darf die Meldung nicht kippen. */
    });
  return true;
}

/**
 * Sicherheitsnetz einer Regel „Betriebsende“ (`closingNetDue`): Schliess-
 * Aktionen auf den Geraeten, die eine zugehoerige Regel „Betriebsbeginn“
 * oeffnet, einmal ausfuehren. Laeufe von Hand an der Oeffnungs-Regel zaehlen
 * nicht als Oeffnung: Wer ausserhalb der Betriebszeit von Hand oeffnet, will
 * das so. Ebenso wenig Oeffnungen vor dem Anlegen dieser Regel oder von vor
 * mehr als sieben Tagen (`closingNetSince`). Betrieb zaehlt nach beiden
 * Regeln: Die Oeffnungs-Regel kann einer anderen Betriebszeit folgen.
 */
async function runClosingNet(
  rule: LoadedRule,
  occurrences: RuleOccurrence[],
  now: Date,
  hubState: () => Promise<HubRuleState | null>,
): Promise<boolean | null> {
  const openings = (await prisma.roomRule.findMany({
    where: { accountId: rule.accountId, trigger: "OPENING" },
    include: ruleInclude,
  })) as LoadedRule[];
  const devices = pairedCloseDevices(rule.actions, openings.map((o) => o.actions));
  if (devices.size === 0) return null;
  const paired = openings.filter((o) => o.actions.some((a) => a.kind === "DEVICE" && a.deviceAction === "open" && a.deviceId && devices.has(a.deviceId)));

  // Oeffnungen vor dem Anlegen dieser Regel gehen das Netz nichts an. Ihr
  // Vermerk zaehlt nicht: Eine Aenderung am Zeitplan nach der Oeffnung des
  // Tages laesse sonst das Tor offen, wenn der Termin danach scheitert.
  const since = closingNetSince(rule, now);
  const openRows = await prisma.roomRuleRun.findMany({
    where: {
      accountId: rule.accountId,
      ruleId: { in: paired.map((o) => o.id) },
      triggerKind: { in: ["opening", "hub:opening"] },
      triggeredAt: { gte: since },
    },
    select: { ruleId: true, triggerKind: true, triggeredAt: true, success: true, details: true, errorMessage: true },
    orderBy: { triggeredAt: "desc" },
    take: 20,
  });
  const openActions = new Map(paired.flatMap((o) => o.actions.map((a) => [a.id, a] as const)));
  // Geoeffnet hat ein Lauf, sobald mindestens ein Geraet aufging; geschlossen
  // erst, wenn alle zugingen.
  const opened = openRows.filter((r) => {
    const touched = rowTouchesDevices(r, openActions, devices, "open");
    return touched === "ok" || touched === "partial";
  });
  const lastOpenedAt = opened[0]?.triggeredAt ?? null;
  if (!lastOpenedAt) return null;

  const closeRows = await prisma.roomRuleRun.findMany({
    where: { accountId: rule.accountId, ruleId: rule.id, triggeredAt: { gte: lastOpenedAt } },
    select: { triggerKind: true, triggeredAt: true, success: true, details: true, errorMessage: true },
    orderBy: { triggeredAt: "desc" },
    take: 50,
  });
  const ownActions = new Map(rule.actions.map((a) => [a.id, a] as const));
  const lastClosedAt = closeRows.find((r) => rowTouchesDevices(r, ownActions, devices, "close") === "ok")?.triggeredAt ?? null;
  const lastNetAt = closeRows.find((r) => r.triggerKind === CLOSING_NET_KIND)?.triggeredAt ?? null;

  // Betrieb laut dieser Regel oder laut einer Regel „Betriebsbeginn“, die
  // seitdem geoeffnet hat: Sie kann einer anderen Betriebszeit folgen
  // (eigene, Raum, Reichweite). Das Netz schliesst nur, wenn keine davon
  // gerade Betrieb hat.
  const lead = Math.max(0, ...paired.map((o) => -o.offsetMinutes)) * 60_000;
  const openers = await withExtendedSpecs(
    paired.filter((o) => opened.some((r) => r.ruleId === o.id)),
    now,
  );
  const operatingNearby = [rule, ...openers].some((r) => {
    const ctx = contextFor(r, now);
    return openSpansBetween(ctx.schedule, new Date(now.getTime() - CLOSING_NET_AFTER_MS), new Date(now.getTime() + lead), ctx.timezone).length > 0;
  });
  const ahead = Math.max(0, rule.offsetMinutes) * 60_000;
  const ownPending = occurrences.some(
    (o) => o.at.getTime() > lastOpenedAt.getTime() && o.at.getTime() <= now.getTime() + ahead && now.getTime() < o.until.getTime(),
  );

  if (!closingNetDue({ lastOpenedAt, lastClosedAt, lastNetAt, operatingNearby, ownPending }, now)) return null;
  const netAction = (a: { kind: string; deviceAction: string | null; deviceId: number | null }) =>
    a.kind === "DEVICE" && a.deviceAction === "close" && !!a.deviceId && devices.has(a.deviceId);

  // Kann der Hub den eigenen Termin seit der Oeffnung im Notbetrieb
  // geschlossen haben, ohne dass sein Lauf schon da ist, wartet das Netz
  // darauf (hoechstens bis `MISSED_HUB_WAIT_MS` nach Fristende): sonst
  // fuehre das Tor ein zweites Mal zu oder das Netz verbrauchte seinen
  // einzigen Versuch, waehrend der Hub ohne Verbindung ist.
  const own = lastOccurrenceAfter(occurrences, lastOpenedAt, now);
  if (own) {
    const hub = await hubState();
    const keys = actionKeys(rule.actions);
    const scope = hubRunScope(hub, rule.id, own, await attemptsFor(rule, own));
    const decision = missedDecision(
      {
        missingKeys: rule.actions.filter(netAction).map((a) => keys.get(a.id) as string),
        hubKeys: scope ? await hubLocalKeys(rule, hub, scope) : new Set<string>(),
        hubMayHaveRun: scope !== null,
        until: own.until,
      },
      now,
    );
    if (decision === "wait") return null;
  }

  if (!(await claimRule(rule.id, RULE_RUN_LOCK_MS / 1000, now))) return null;
  const executed = await executeRule(rule.id, CLOSING_NET_KIND, { onlyActions: netAction });
  return executed.success;
}

/** Verlaufs-Art der Laeufe des Sicherheitsnetzes zum Betriebsende. */
export const CLOSING_NET_KIND = "closing-net";

/** Ohne Lauf so weit zurueck schauen, wenn es um die letzte Aktivitaet geht. */
const IDLE_LOOKBACK_MS = 48 * 3_600_000;

/**
 * Kameras und letzte Aktivitaet im Raum einer Regel „Ruhe im Raum“. Gezaehlt
 * werden nur die Ereignisarten der Regel (`idleActivityTypes`). Ein laufendes
 * Ereignis ist Aktivitaet bis jetzt, ein offenes, dessen Kamera der Hub nicht
 * mehr meldet, bis zu deren letzter Meldung (`activityAt`). Gesucht wird ab
 * dem letzten Lauf: Was davor lag, aendert an der Faelligkeit nichts.
 */
async function roomActivity(
  rule: LoadedRule,
  now: Date,
): Promise<{ hasSensors: boolean; lastActivity: Date | null }> {
  if (!rule.roomId) return { hasSensors: false, lastActivity: null };
  const cameras = await prisma.camera.findMany({
    where: { accountId: rule.accountId, keyRoomId: rule.roomId, enabled: true },
    select: { id: true, lastSeenAt: true },
  });
  if (cameras.length === 0) return { hasSensors: false, lastActivity: null };

  const types = idleActivityTypes(rule.eventType);
  const cameraIds = cameras.map((c) => c.id);
  const floor = rule.lastRunAt ?? new Date(now.getTime() - IDLE_LOOKBACK_MS);
  const [ended, open] = await Promise.all([
    prisma.cameraEvent.findFirst({
      where: {
        accountId: rule.accountId,
        cameraId: { in: cameraIds },
        type: { in: types },
        // Laenger als einen Tag gilt ein Ereignis nicht als laufend
        // (OPEN_EVENT_MAX_AGE_MS); die Grenze haelt die Suche auf dem Index.
        startedAt: { gte: new Date(floor.getTime() - OPEN_EVENT_MAX_AGE_MS) },
        endedAt: { gte: floor },
      },
      orderBy: { endedAt: "desc" },
      select: { startedAt: true, endedAt: true },
    }),
    prisma.cameraEvent.findMany({
      where: {
        accountId: rule.accountId,
        cameraId: { in: cameraIds },
        type: { in: types },
        endedAt: null,
        startedAt: { gte: new Date(now.getTime() - OPEN_EVENT_MAX_AGE_MS) },
      },
      select: { cameraId: true, startedAt: true, endedAt: true },
      take: 50,
    }),
  ]);
  const seen = new Map(cameras.map((c) => [c.id, c.lastSeenAt]));
  let last = ended?.endedAt?.getTime() ?? null;
  for (const e of open) {
    const at = activityAt(e, seen.get(e.cameraId) ?? null, now).getTime();
    if (at >= floor.getTime() && (last == null || at > last)) last = at;
  }
  return { hasSensors: true, lastActivity: last == null ? null : new Date(last) };
}

/**
 * Eine Zeit-Regel im Cron-Lauf: faelligen Termin ausfuehren oder nachholen,
 * verpassten Termin melden, Sicherheitsnetz zum Betriebsende.
 */
async function tickTimedRule(
  rule: LoadedRule,
  now: Date,
  hubState: () => Promise<HubRuleState | null>,
  result: TickResult,
): Promise<void> {
  const occurrences = timedOccurrences(rule, now);
  const step = nextDueStep(
    occurrences,
    { lastOccurrenceAt: rule.lastOccurrenceAt, lastMissedAt: rule.lastMissedAt, createdAt: rule.createdAt },
    now,
  );

  if (step.kind !== "none") {
    const occ = step.occurrence;
    const attempts = await settledAttemptsFor(rule, occ, now);
    const summary = summarizeAttempts(rule.actions, attempts);
    if (summary.done) {
      // Laut Verlauf gelaufen (etwa vor der Nachholfrist, vom Hub oder mit
      // inzwischen erledigtem Hub-Auftrag): vermerken.
      await markOccurrence(rule.accountId, rule.id, occ.at);
    } else if (step.kind === "missed") {
      // Fehlt nur, was der Hub im Notbetrieb selbst schaltet, und kann er es
      // geschaltet haben, wartet die Meldung auf seinen Lauf (rule-due.ts,
      // `missedDecision`): Ein Ausfall des Netzes am Standort ergaebe sonst
      // eine falsche Meldung „nicht ausgefuehrt“.
      const hub = await hubState();
      // Termin kurz vor seinem letzten Kontakt: Der Hub holt davon nur Aus und Zu nach.
      const scope = hubRunScope(hub, rule.id, occ, attempts);
      const decision = missedDecision(
        {
          missingKeys: [...actionKeys(rule.actions).values()].filter((k) => !summary.okKeys.has(k)),
          hubKeys: scope ? await hubLocalKeys(rule, hub, scope) : new Set<string>(),
          hubMayHaveRun: scope !== null,
          until: occ.until,
        },
        now,
      );
      if (decision !== "wait") {
        const silentSince = decision === "report-unconfirmed" ? (hub?.rules?.at ?? null) : undefined;
        if (await reportMissed(rule, occ, summary, now, silentSince)) {
          result.results.push({ ruleId: rule.id, name: rule.name, trigger: rule.trigger, success: false, occurrenceAt: occ.at.toISOString(), kind: "verpasst" });
        }
      }
    } else {
      // Gelungen oder mit offenem Hub-Auftrag in Arbeit: kein zweiter Versuch.
      const skip = new Set([...summary.okKeys, ...summary.pendingKeys]);
      // Der Hub hat den Termin im Notbetrieb geschaltet und meldet seinen Lauf
      // gleich: Was er selbst schaltet, holt die Cloud nicht ein zweites Mal nach.
      const hub = await hubState();
      if (hubRunAnnounced(hub, rule.id, occ, attempts)) {
        for (const key of await hubLocalKeys(rule, hub)) skip.add(key);
      }
      const keys = [...actionKeys(rule.actions).values()];
      if (keys.some((k) => !skip.has(k)) && (await claimRule(rule.id, RULE_RUN_LOCK_MS / 1000, now))) {
        const executed = await executeRule(rule.id, rule.trigger.toLowerCase(), { skipKeys: skip, eventAt: occ.at });
        const ok = new Set(summary.okKeys);
        // Ein an den Hub uebergebener Auftrag zaehlt erst mit seinem Ergebnis
        // (naechster Cron-Lauf, `settledAttemptsFor`).
        for (const a of executed.actions) if (a.ok && a.key) ok.add(a.key);
        if (keys.every((k) => ok.has(k))) await markOccurrence(rule.accountId, rule.id, occ.at);
        result.triggered++;
        result.results.push({
          ruleId: rule.id,
          name: rule.name,
          trigger: rule.trigger,
          success: executed.success,
          occurrenceAt: occ.at.toISOString(),
          kind: summary.attempts > 0 ? "nachgeholt" : "termin",
        });
      }
      // Waehrend ein eigener Termin laeuft, wartet das Sicherheitsnetz.
      return;
    }
  }

  if (rule.trigger === "CLOSING") {
    const net = await runClosingNet(rule, occurrences, now, hubState);
    if (net !== null) {
      result.triggered++;
      result.results.push({ ruleId: rule.id, name: rule.name, trigger: rule.trigger, success: net, kind: "netz" });
    }
  }
}

/**
 * Cron-Durchlauf fuer alles Zeitgesteuerte: feste Uhrzeit, Betriebsbeginn und
 * -ende, Sonnenzeiten und Ruhe im Raum.
 */
export async function runRuleTick(now = new Date()): Promise<TickResult> {
  const timed: RuleTrigger[] = ["TIME", "OPENING", "CLOSING", "SUNRISE", "SUNSET", "IDLE"];
  const rules = await withExtendedSpecs((await prisma.roomRule.findMany({
    where: { isActive: true, trigger: { in: timed } },
    include: ruleInclude,
  })) as LoadedRule[], now);

  const result: TickResult = { checked: rules.length, triggered: 0, results: [] };
  const hubStates = new Map<number, Promise<HubRuleState | null>>();
  const hubState = (accountId: number) => () => {
    let state = hubStates.get(accountId);
    if (!state) {
      state = loadHubState(accountId);
      hubStates.set(accountId, state);
    }
    return state;
  };

  // Laeufe mit an den Hub uebergebenen Aktionen, deren Auftrag inzwischen
  // verfallen ist (die Abholung und die Datenpflege setzen ihn per
  // updateMany auf FAILED, ohne Ergebnis-Route): im Verlauf nachtragen.
  await settleAllHubHandovers(now).catch((e) => {
    console.error("[room-rules] Hub-Ergebnisse im Cron-Lauf nicht nachgetragen:", (e as Error).message);
  });

  for (const rule of rules) {
    if (isTimedTrigger(rule.trigger)) {
      // Eine Regel, die scheitert, haelt die uebrigen nicht auf.
      try {
        await tickTimedRule(rule, now, hubState(rule.accountId), result);
      } catch (e) {
        console.error(`[room-rules] Regel ${rule.id} im Cron-Lauf fehlgeschlagen:`, (e as Error).message);
      }
      continue;
    }

    const ctx = contextFor(rule, now);
    if (!ruleAllows(rule, ctx)) continue;
    // Einmal je Ruhephase und nur mit Kamera im Raum (rule-due.ts, idleDue).
    const activity = await roomActivity(rule, now);
    if (!idleDue(rule.idleMinutes, activity.lastActivity, rule.lastRunAt, activity.hasSensors, now)) continue;

    // Zwei Cron-Laeufe kurz nacheinander duerfen nicht beide feuern, auch wenn
    // die Sperrzeit kuerzer ist.
    const cooldown = Math.max(rule.cooldownSeconds, FIRE_WINDOW_MS / 1000);
    if (!(await claimRule(rule.id, cooldown, now))) continue;

    // Ereignis einer Ruhe-Regel: Beginn der Ruhe (letzte Aktivitaet plus Wartezeit).
    const idleSince =
      activity.lastActivity && rule.idleMinutes
        ? new Date(activity.lastActivity.getTime() + rule.idleMinutes * 60_000)
        : null;
    const executed = await executeRule(rule.id, rule.trigger.toLowerCase(), { eventAt: idleSince });
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
 * Passt eine Bewegungs-Regel zu Kamera, Raum der Kamera und Ereignisart?
 * Eine Regel mit Kamera gilt nur fuer diese; ohne Kamera fuer jede Kamera
 * ihres Raums. Ohne Ereignisart gilt sie fuer jede.
 */
export function motionRuleMatches(
  rule: { cameraId: number | null; roomId: number | null; eventType: string | null },
  cameraId: number,
  keyRoomId: number | null,
  eventType: string,
): boolean {
  if (rule.eventType && rule.eventType !== eventType) return false;
  if (rule.cameraId != null) return rule.cameraId === cameraId;
  return keyRoomId != null && rule.roomId === keyRoomId;
}

/** Alle aktiven Bewegungs-Regeln des Mandanten, samt erweiterter Betriebszeit. */
async function loadMotionRules(accountId: number, now: Date): Promise<LoadedRule[]> {
  const rules = (await prisma.roomRule.findMany({
    where: { accountId, isActive: true, trigger: "MOTION" },
    include: ruleInclude,
  })) as LoadedRule[];
  if (rules.length === 0) return rules;
  return withExtendedSpecs(rules, now);
}

/**
 * Geraete der Aktionen und Ausloeser von „Geraet geschaltet“: was
 * `decideExecutor` (rule-executor.ts) fuer Bewegungs-Regeln braucht.
 */
async function loadExecutorContext(accountId: number, rules: Array<{ actions: RoomRuleAction[] }>): Promise<ExecutorContext> {
  const ids = [
    ...new Set(rules.flatMap((r) => r.actions.filter((a) => a.kind === "DEVICE" && a.deviceId).map((a) => a.deviceId as number))),
  ];
  const [devices, switched] = await Promise.all([
    ids.length
      ? prisma.device.findMany({
          where: { id: { in: ids }, accountId },
          select: { id: true, type: true, category: true, ipAddress: true, hueBridgeId: true, hueLightId: true, isActive: true },
        })
      : Promise.resolve([]),
    prisma.roomRule.findMany({
      where: { accountId, isActive: true, trigger: "DEVICE_SWITCHED", triggerDeviceId: { not: null } },
      select: { triggerDeviceId: true },
    }),
  ]);
  return {
    devices: new Map(devices.map((d) => [d.id, { ...d, category: d.category ?? null }])),
    switchTriggers: new Set(switched.map((r) => r.triggerDeviceId as number)),
  };
}

/** Stand einer Regel, wie ihn der Plan des Hubs fuehrt (`hubConfigAt`). */
export function ruleConfigAt(rule: { configChangedAt: Date | null; createdAt: Date }): string {
  return (rule.configChangedAt ?? rule.createdAt).toISOString();
}

/** Vom Hub selbst ausgefuehrte Regel zu einem Ereignis: ID und Stand laut seinem Plan. */
export interface HubRanRule {
  ruleId: number;
  configAt: string;
}

/**
 * Passende Bewegungs-Regeln pruefen, sperren und ausfuehren. `now` ist die
 * Zeit des Kamera-Ereignisses. `byHub`: Regeln, die der Hub zu diesem
 * Ereignis schon selbst ausgefuehrt hat (rule-executor.ts). Die Cloud sperrt
 * sie wie einen eigenen Lauf, fuehrt sie aber nicht aus, wenn der Hub den
 * aktuellen Stand der Regel hatte und sie jetzt ebenfalls dem Hub zuschreibt;
 * sonst laeuft sie wie bisher.
 */
async function fireMotionRules(
  rules: LoadedRule[],
  now: Date,
  byHub?: { ids: Map<number, string>; ctx: ExecutorContext },
): Promise<{ triggered: number; rules: TriggeredRuleRun[]; byHub: number }> {
  let triggered = 0;
  let hubRan = 0;
  const runs: TriggeredRuleRun[] = [];
  for (const rule of rules) {
    if (!ruleAllows(rule, contextFor(rule, now))) continue;
    const ranOnHub =
      !!byHub && byHub.ids.get(rule.id) === ruleConfigAt(rule) && decideExecutor(rule, byHub.ctx).by === "hub";
    if (!(await claimRule(rule.id, rule.cooldownSeconds, now))) continue;
    if (ranOnHub) {
      hubRan++;
      continue;
    }
    triggered++;
    const executed = await executeRule(rule.id, "motion", { eventAt: now });
    runs.push({
      ruleId: rule.id,
      name: rule.name,
      state: runState({ success: executed.success, details: executed.actions }),
      durationMs: executed.durationMs,
    });
  }
  return { triggered, rules: runs, byHub: hubRan };
}

/**
 * Bewegungs-Regeln fuer eine ganze Meldung des Hubs: Die aktiven Regeln
 * werden beim ersten Beginn einmal geladen, nicht je Ereignis. Hat der
 * Mandant keine, kehrt jeder Aufruf sofort zurueck. `keyRoomId` ist der Raum
 * der Kamera, den die Meldung ohnehin geladen hat.
 */
export function motionRuleRunner(accountId: number, now = new Date()) {
  let loaded: Promise<LoadedRule[]> | null = null;
  let executor: Promise<ExecutorContext> | null = null;
  return async (
    cameraId: number,
    keyRoomId: number | null,
    eventType: string,
    at: Date,
    /** Vom Hub zu diesem Ereignis selbst ausgefuehrte Regeln; fehlt bei aelteren Hubs. */
    hubRules: HubRanRule[] = [],
  ): Promise<{ triggered: number; rules: TriggeredRuleRun[]; byHub: number }> => {
    loaded ??= loadMotionRules(accountId, now);
    const rules = await loaded;
    if (rules.length === 0) return { triggered: 0, rules: [], byHub: 0 };
    const matching = rules.filter((r) => motionRuleMatches(r, cameraId, keyRoomId, eventType));
    if (hubRules.length === 0) return fireMotionRules(matching, at);
    executor ??= loadExecutorContext(accountId, rules);
    const ids = new Map(hubRules.map((r) => [r.ruleId, r.configAt]));
    return fireMotionRules(matching, at, { ids, ctx: await executor });
  };
}

/**
 * Bewegung, Person oder Fahrzeug im Raum, fuer ein einzelnes Ereignis. Der
 * Hub-Ingest der Kamera-Ereignisse nimmt `motionRuleRunner` (einmal laden je
 * Meldung); ohne aktive Bewegungs-Regel fragt auch diese Fassung die Kamera
 * gar nicht erst ab.
 */
export async function runMotionRules(
  accountId: number,
  cameraId: number,
  eventType: string,
  now = new Date(),
): Promise<{ triggered: number; rules: TriggeredRuleRun[]; byHub: number }> {
  const rules = await loadMotionRules(accountId, now);
  if (rules.length === 0) return { triggered: 0, rules: [], byHub: 0 };
  const camera = await prisma.camera.findFirst({
    where: { id: cameraId, accountId },
    select: { keyRoomId: true },
  });
  return fireMotionRules(
    rules.filter((r) => motionRuleMatches(r, cameraId, camera?.keyRoomId ?? null, eventType)),
    now,
  );
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

  const rules = await withExtendedSpecs((await prisma.roomRule.findMany({
    where: {
      accountId,
      isActive: true,
      trigger: "DEVICE_SWITCHED",
      triggerDeviceId: deviceId,
      OR: [{ triggerAction: null }, { triggerAction: action }],
    },
    include: ruleInclude,
  })) as LoadedRule[], now);

  let triggered = 0;
  for (const rule of rules) {
    if (!ruleAllows(rule, contextFor(rule, now))) continue;
    if (!(await claimRule(rule.id, rule.cooldownSeconds, now))) continue;
    triggered++;
    await executeRule(rule.id, "device", { depth, eventAt: now });
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
  const rules = await withExtendedSpecs((await prisma.roomRule.findMany({
    where: {
      accountId,
      isActive: true,
      trigger: "SCAN",
      OR: [{ areaId: null }, ...(areaIds.length > 0 ? [{ areaId: { in: areaIds } }] : [])],
    },
    include: ruleInclude,
  })) as LoadedRule[], now);

  let triggered = 0;
  for (const rule of rules) {
    if (rule.scanDirection && rule.scanDirection !== direction) continue;
    if (!ruleAllows(rule, contextFor(rule, now))) continue;
    if (!(await claimRule(rule.id, rule.cooldownSeconds, now))) continue;
    triggered++;
    await executeRule(rule.id, "scan", { eventAt: now });
  }
  return { triggered };
}

// ─── Notbetrieb-Plan fuer den Hub ─────────────────────────────────────────────

export interface HubRulePlanRule {
  id: number;
  name: string;
  roomId: number | null;
  trigger: RuleTrigger;
  cooldownSeconds: number;
  /** MOTION */
  cameraId: number | null;
  eventType: string | null;
  /** DEVICE_SWITCHED */
  triggerDeviceId: number | null;
  triggerAction: string | null;
  /** IDLE */
  idleMinutes: number | null;
  /** Ereignis-Ausloeser: Zeitraeume, in denen die Bedingungen erfuellt sind. */
  allowed: PlanInterval[];
  /** Zeit-Ausloeser: konkrete Zeitpunkte, an denen die Regel feuert. */
  fireAt: string[];
  /**
   * Zeit-Ausloeser: Ende der Nachholfrist je Termin, in derselben Reihenfolge
   * wie `fireAt`. Der Hub fuehrt einen Termin im Notbetrieb bis dahin aus
   * (hub/src/outage-rules.ts, `dueInOutage`).
   */
  fireUntil: string[];
  /**
   * Bewegung: Der Hub darf die Regel direkt ausfuehren (rule-executor.ts,
   * `decideExecutor`); dann auch `hubCameraIds`, `allowedExact` und
   * `lastRunAt`. Fehlt bei allen anderen Regeln.
   */
  hubLocal?: boolean;
  /** hubLocal: Kameras, fuer die die Regel gilt (wie `motionRuleMatches`). */
  hubCameraIds?: number[];
  /** hubLocal: Zeitraeume ohne Raster, halboffen [from, to) (rule-plan.ts, `exactIntervals`). */
  allowedExact?: PlanInterval[];
  /** hubLocal: letzter Lauf laut Cloud, fuer die Abklingzeit. */
  lastRunAt?: string | null;
  /** hubLocal: Stand der Regel (`ruleConfigAt`); der Hub nennt ihn mit dem Ereignis. */
  hubConfigAt?: string;
  actions: Array<{
    id: number;
    /** Schluessel der Aktion (rule-due.ts, `actionKeys`); der Hub gibt ihn im Lauf zurueck. */
    key: string;
    kind: string;
    deviceId: number | null;
    deviceAction: string | null;
    timerSeconds: number | null;
    targetCameraId: number | null;
    ptzPresetId: number | null;
    autoTrack: boolean | null;
    returnAfterSeconds: number | null;
  }>;
}

const TIMED_TRIGGERS = new Set<RuleTrigger>(["TIME", "OPENING", "CLOSING", "SUNRISE", "SUNSET"]);

/**
 * Zeitraeume in [from, end], in denen die Bedingungen der Regel erfuellt
 * sind, im Zwei-Minuten-Raster ab `from` (rule-plan.ts). Ausgewertet wird
 * nur dort, wo das Ergebnis kippen kann; heraus kommt dasselbe wie beim
 * Abtasten alle zwei Minuten. Der Hub prueft damit Ereignis-Regeln im
 * Notbetrieb (hub/src/rule-plan-rules.ts, `inAllowed`).
 */
export function allowedIntervals(rule: RuleConditions, env: OccurrenceEnv, from: Date, end: Date): PlanInterval[] {
  const points = [from.getTime(), ...conditionChangePoints(rule, env, from, end)].map((at) => ({
    at,
    ok: ruleAllows(rule, { ...env, now: new Date(at) }),
  }));
  return rasterIntervals(points, from.getTime(), end.getTime());
}

/**
 * Zeitraeume in [from, end), in denen die Bedingungen der Regel erfuellt
 * sind, ohne Raster: an jeder Stelle genau wie `ruleAllows`. Fuer
 * Bewegungs-Regeln, die der Hub direkt ausfuehrt.
 */
export function allowedExactIntervals(rule: RuleConditions, env: OccurrenceEnv, from: Date, end: Date): PlanInterval[] {
  const points = [from.getTime(), ...conditionChangePoints(rule, env, from, end)].map((at) => ({
    at,
    ok: ruleAllows(rule, { ...env, now: new Date(at) }),
  }));
  return exactIntervals(points, end.getTime());
}

/**
 * Zeitpunkte einer Zeit-Regel in [from, end]: dieselben Termine wie im
 * Cron-Lauf (rule-due.ts), je Tag direkt gerechnet und auf die Minute
 * gerundet.
 */
export function planFireTimes(
  rule: RuleConditions & TimedRuleSpec,
  env: OccurrenceEnv,
  from: Date,
  end: Date,
): string[] {
  return planFireWindows(rule, env, from, end).fireAt;
}

/**
 * Wie `planFireTimes`, dazu je Termin das Ende seiner Nachholfrist
 * (`fireUntil`, gleiche Reihenfolge). Fallen zwei Termine auf dieselbe
 * Minute, gilt die laengere Frist.
 */
export function planFireWindows(
  rule: RuleConditions & TimedRuleSpec,
  env: OccurrenceEnv,
  from: Date,
  end: Date,
): { fireAt: string[]; fireUntil: string[] } {
  const until = new Map<string, number>();
  for (const occ of allowedOccurrences(rule, env, occurrencesBetween(rule, env, from, end))) {
    const at = new Date(Math.round(occ.at.getTime() / 60_000) * 60_000).toISOString();
    until.set(at, Math.max(until.get(at) ?? 0, occ.until.getTime()));
  }
  const fireAt = [...until.keys()].sort();
  return { fireAt, fireUntil: fireAt.map((at) => new Date(until.get(at) as number).toISOString()) };
}

/**
 * Plan fuer den Notbetrieb des Hubs: alle aktiven Regeln mit vorab
 * ausgewerteten Bedingungen fuer die naechsten Stunden.
 *
 * Der Hub soll Regeln nur weiterfuehren, wenn er die Cloud nicht erreicht.
 * Damit er dafuer keine zweite Kopie der Betriebszeit-, Sonnen- und
 * Zeitfenster-Logik braucht, rechnet die Cloud hier vor:
 *  - Zeit-Ausloeser: die konkreten Zeitpunkte, an denen die Regel feuern wuerde.
 *  - Ereignis-Ausloeser (Bewegung, Schaltvorgang, Ruhe): die Zeitraeume, in
 *    denen ihre Bedingungen erfuellt sind (Raster 2 Minuten).
 * SCAN-Regeln fehlen bewusst: Zutritte laufen ohnehin ueber die Cloud.
 */
export async function buildHubRulePlan(
  accountId: number,
  from = new Date(),
  hours = 48,
): Promise<HubRulePlanRule[]> {
  const rules = await withExtendedSpecs((await prisma.roomRule.findMany({
    where: { accountId, isActive: true, trigger: { not: "SCAN" } },
    include: ruleInclude,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  })) as LoadedRule[], from);

  const end = new Date(from.getTime() + hours * 3_600_000);
  const out: HubRulePlanRule[] = [];

  // Bewegungs-Regeln, die der Hub direkt ausfuehren darf (rule-executor.ts).
  const motion = rules.filter((r) => r.trigger === "MOTION");
  const executor = motion.length ? await loadExecutorContext(accountId, motion) : null;
  const cameras = motion.length
    ? await prisma.camera.findMany({ where: { accountId }, select: { id: true, keyRoomId: true } })
    : [];

  for (const rule of rules) {
    const env = occurrenceEnv(rule, from);
    const hubLocal = rule.trigger === "MOTION" && executor !== null && decideExecutor(rule, executor).by === "hub";
    const timed = TIMED_TRIGGERS.has(rule.trigger);
    const allowed = timed ? [] : allowedIntervals(rule, env, from, end);
    const { fireAt, fireUntil } = timed ? planFireWindows(rule, env, from, end) : { fireAt: [], fireUntil: [] };
    const keys = actionKeys(rule.actions);

    out.push({
      id: rule.id,
      name: rule.name,
      roomId: rule.roomId,
      trigger: rule.trigger,
      cooldownSeconds: rule.cooldownSeconds,
      cameraId: rule.cameraId,
      eventType: rule.eventType,
      triggerDeviceId: rule.triggerDeviceId,
      triggerAction: rule.triggerAction,
      idleMinutes: rule.idleMinutes,
      allowed,
      fireAt,
      fireUntil,
      ...(rule.trigger === "MOTION" ? { hubLocal } : {}),
      ...(hubLocal
        ? {
            hubCameraIds:
              rule.cameraId != null
                ? [rule.cameraId]
                : cameras.filter((c) => rule.roomId != null && c.keyRoomId === rule.roomId).map((c) => c.id),
            allowedExact: allowedExactIntervals(rule, env, from, end),
            lastRunAt: rule.lastRunAt?.toISOString() ?? null,
            hubConfigAt: ruleConfigAt(rule),
          }
        : {}),
      actions: rule.actions.map((a) => ({
        id: a.id,
        key: keys.get(a.id) ?? String(a.id),
        kind: a.kind,
        deviceId: a.deviceId,
        deviceAction: a.deviceAction,
        timerSeconds: a.timerSeconds,
        targetCameraId: a.targetCameraId,
        ptzPresetId: a.ptzPresetId,
        autoTrack: a.autoTrack,
        returnAfterSeconds: a.returnAfterSeconds,
      })),
    });
  }
  return out;
}

/**
 * Termin einer Zeit-Regel, zu dem ein vom Hub gemeldeter Lauf gehoert. Der
 * Hub fuehrt einen Termin aus seinem Plan (auf die Minute gerundet) bis zu
 * drei Minuten spaet aus; `fireAt` ist der Termin laut Plan, sonst zaehlt
 * die Zeit des Laufs.
 */
export function hubRunOccurrence(occurrences: RuleOccurrence[], at: Date, fireAt: Date | null): RuleOccurrence | null {
  const ref = (fireAt ?? at).getTime();
  return occurrences.find((o) => hubFireMatches(o, ref)) ?? null;
}

/**
 * Laeufe, die der Hub im Notbetrieb ausgefuehrt hat, nachtragen. Setzt auch
 * `lastRunAt`, damit die Cloud dieselbe Regel nicht gleich noch einmal feuert.
 * Ein Termin einer Zeit-Regel zaehlt als gelaufen (`lastOccurrenceAt`),
 * sobald seine Laeufe zusammen jede Aktion geschafft haben
 * (`summarizeAttempts`): der Lauf des Hubs, seine Wiederholungen im
 * Notbetrieb (nur, was noch fehlte) und Versuche der Cloud. Die Cloud holt
 * ihn dann nach ihrer Rueckkehr nicht noch einmal nach; sonst nur die
 * Aktionen, die noch fehlen.
 */
export async function recordHubRuleRuns(
  accountId: number,
  runs: Array<{
    ruleId: number;
    at: Date;
    /** Termin laut Plan des Hubs; fehlt bei aelteren Hubs. */
    fireAt?: Date | null;
    /** Zeit des ausloesenden Ereignisses (Bewegung direkt vom Hub); fehlt bei aelteren Hubs. */
    eventAt?: Date | null;
    /** Ende des Laufs im Hub; fehlt bei aelteren Hubs. */
    finishedAt?: Date | null;
    triggerKind: string;
    success: boolean;
    details: unknown;
    errorMessage: string | null;
    /**
     * Bewegung direkt vom Hub, nicht in der Frist oder nicht ganz gelungen:
     * Die Cloud fuehrt die Regel selbst aus; der Lauf steht nur im Verlauf.
     */
    handedOver?: boolean;
  }>,
): Promise<number> {
  let saved = 0;
  for (const run of runs) {
    const rule = (await prisma.roomRule.findFirst({
      where: { id: run.ruleId, accountId },
      include: ruleInclude,
    })) as LoadedRule | null;
    if (!rule) continue;
    // Schon gemeldet (Antwort ging verloren, der Hub meldet noch einmal): nicht doppelt eintragen.
    const known = await prisma.roomRuleRun.findFirst({
      where: { accountId, ruleId: rule.id, triggerKind: `hub:${run.triggerKind}`, triggeredAt: run.at },
      select: { id: true },
    });
    if (known) {
      saved++;
      continue;
    }
    const eventAt = run.eventAt ?? run.fireAt ?? null;
    const durationMs =
      run.finishedAt && run.finishedAt.getTime() >= run.at.getTime() ? run.finishedAt.getTime() - run.at.getTime() : null;
    await prisma.roomRuleRun.create({
      data: {
        accountId,
        ruleId: rule.id,
        ruleName: rule.name,
        roomId: rule.roomId,
        triggeredAt: run.at,
        triggerKind: `hub:${run.triggerKind}`,
        success: run.success,
        // Nur die Felder, die der Hub schreibt (`sanitizeHubRunDetails`).
        details: sanitizeHubRunDetails(run.details) as unknown as Prisma.InputJsonValue,
        errorMessage: run.errorMessage,
        // Der Hub meldet den Beginn seines Laufs, bei Zeit-Regeln den Termin,
        // bei Bewegung die Zeit des Ereignisses.
        startedAt: run.at,
        ...(eventAt ? { eventAt } : {}),
        ...(durationMs !== null ? { durationMs } : {}),
      },
    });
    // Bewegung direkt vom Hub: Abklingzeit ab dem Ereignis, wie beim Sperren in der Cloud.
    // An die Cloud abgegeben: Sie sperrt die Regel selbst; kaeme der Lauf vor
    // ihrem Sperren an, fiele ihr Lauf sonst in die Abklingzeit.
    const ranAt = run.triggerKind === "motion" && run.eventAt ? run.eventAt : run.at;
    if (!run.handedOver && (!rule.lastRunAt || rule.lastRunAt < ranAt)) {
      await prisma.roomRule.update({ where: { id: rule.id, accountId }, data: { lastRunAt: ranAt } });
    }
    // Erledigt erst, wenn die Laeufe zum Termin zusammen jede Aktion geschafft
    // haben: Eine Wiederholung im Notbetrieb enthaelt nur, was noch fehlte.
    if (isTimedTrigger(rule.trigger)) {
      await withExtendedSpecs([rule], run.at);
      const occ = hubRunOccurrence(timedOccurrences(rule, run.at), run.at, run.fireAt ?? null);
      if (occ && summarizeAttempts(rule.actions, await attemptsFor(rule, occ)).done) {
        await markOccurrence(rule.accountId, rule.id, occ.at);
      }
    }
    saved++;
  }
  return saved;
}
