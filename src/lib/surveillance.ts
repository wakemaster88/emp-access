/**
 * Überwachungsmodus: manuell und/oder per Zeitplan scharf,
 * Push bei PERSON/VEHICLE auf ausgewählten Kameras,
 * Telegram-Foto bei Sighting mit Snapshot.
 */
import { prisma } from "@/lib/prisma";
import { isWithinTimeWindow } from "@/lib/shelly-automation";
import { sendTelegramPhoto } from "@/lib/telegram";
import { sendPushToAccount } from "@/lib/web-push";

export type SurveillanceEventType = "PERSON" | "VEHICLE";

export interface SurveillanceConfigLike {
  manualArmed: boolean;
  scheduleEnabled: boolean;
  daysOfWeek: number;
  windowStart: string | null;
  windowEnd: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Wochentag als Bit-Index (0=Mo … 6=So) in der Account-Zeitzone. */
function weekdayBitIndex(now: Date, tz: string | null | undefined): number {
  const timeZone = tz ?? "Europe/Berlin";
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" })
    .format(now)
    .toLowerCase();
  const map: Record<string, number> = {
    mon: 0,
    tue: 1,
    wed: 2,
    thu: 3,
    fri: 4,
    sat: 5,
    sun: 6,
  };
  return map[weekday] ?? 0;
}

/** Manuell AN oder Zeitplan trifft zu. */
export function isSurveillanceArmed(
  config: SurveillanceConfigLike,
  now: Date,
  timezone: string | null | undefined
): boolean {
  if (config.manualArmed) return true;
  if (!config.scheduleEnabled) return false;

  const dow = weekdayBitIndex(now, timezone);
  if (((config.daysOfWeek >> dow) & 1) !== 1) return false;

  if (config.windowStart && config.windowEnd) {
    return isWithinTimeWindow(now, config.windowStart, config.windowEnd, timezone);
  }
  // Zeitplan ohne Fenster = ganzer Tag an ausgewählten Wochentagen.
  return true;
}

function pushKey(cameraId: number, type: SurveillanceEventType): string {
  return `${cameraId}:${type}`;
}

function telegramKey(cameraId: number, type: SurveillanceEventType): string {
  return `tg:${cameraId}:${type}`;
}

function parseLastPushMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Sendet ggf. einen Überwachungs-Push (fire-and-forget-tauglich).
 * Cooldown pro Kamera+Typ.
 * PERSON-Alerts kommen aus der Face-Sichtung (nicht vom KI-Event-Start),
 * damit Whitelist-Personen still bleiben.
 */
export async function maybeSurveillanceAlert(opts: {
  accountId: number;
  cameraId: number;
  type: string;
  cameraName?: string | null;
  at?: Date;
}): Promise<{ sent: boolean; reason?: string }> {
  const type = opts.type as SurveillanceEventType;
  if (type !== "PERSON" && type !== "VEHICLE") {
    return { sent: false, reason: "ignored-type" };
  }

  const at = opts.at ?? new Date();

  const [account, config] = await Promise.all([
    prisma.account.findUnique({
      where: { id: opts.accountId },
      select: { timezone: true },
    }),
    prisma.surveillanceConfig.findUnique({
      where: { accountId: opts.accountId },
      include: { cameras: { select: { cameraId: true } } },
    }),
  ]);

  if (!config) return { sent: false, reason: "no-config" };
  if (!isSurveillanceArmed(config, at, account?.timezone)) {
    return { sent: false, reason: "not-armed" };
  }
  if (type === "PERSON" && !config.alertOnPerson) {
    return { sent: false, reason: "person-disabled" };
  }
  if (type === "VEHICLE" && !config.alertOnVehicle) {
    return { sent: false, reason: "vehicle-disabled" };
  }

  const selected = new Set(config.cameras.map((c) => c.cameraId));
  if (selected.size === 0 || !selected.has(opts.cameraId)) {
    return { sent: false, reason: "camera-not-selected" };
  }

  const key = pushKey(opts.cameraId, type);
  const lastMap = parseLastPushMap(config.lastPushByKey);
  const cooldownMs = Math.max(1, config.cooldownMinutes) * 60_000;
  const lastIso = lastMap[key];
  if (lastIso) {
    const last = Date.parse(lastIso);
    if (Number.isFinite(last) && at.getTime() - last < cooldownMs) {
      return { sent: false, reason: "cooldown" };
    }
  }

  let cameraName = opts.cameraName;
  if (!cameraName) {
    const cam = await prisma.camera.findFirst({
      where: { id: opts.cameraId, accountId: opts.accountId },
      select: { name: true },
    });
    cameraName = cam?.name ?? `Kamera ${opts.cameraId}`;
  }

  const label = type === "PERSON" ? "Person" : "Fahrzeug";
  const timeStr = new Intl.DateTimeFormat("de-DE", {
    timeZone: account?.timezone ?? "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(at);

  const result = await sendPushToAccount(opts.accountId, {
    title: `Überwachung: ${label}`,
    body: `${cameraName} · ${timeStr}`,
    url: "/ueberwachung",
    tag: `surveillance-${type.toLowerCase()}-${opts.cameraId}`,
  });

  lastMap[key] = at.toISOString();
  await prisma.surveillanceConfig.update({
    where: { id: config.id },
    data: { lastPushByKey: lastMap },
  });

  return { sent: result.sent > 0, reason: result.sent > 0 ? undefined : "no-subscribers" };
}

/**
 * Sendet ggf. Telegram-Foto bei Sighting mit Snapshot (fire-and-forget-tauglich).
 * Eigener Cooldown (`tg:cameraId:TYPE`), unabhängig vom Web-Push.
 */
export async function maybeSurveillanceTelegramAlert(opts: {
  accountId: number;
  cameraId: number;
  type: string;
  snapshot: Buffer | Uint8Array;
  cameraName?: string | null;
  detail?: string | null;
  at?: Date;
}): Promise<{ sent: boolean; reason?: string }> {
  const type = opts.type as SurveillanceEventType;
  if (type !== "PERSON" && type !== "VEHICLE") {
    return { sent: false, reason: "ignored-type" };
  }
  if (!opts.snapshot?.length) {
    return { sent: false, reason: "no-snapshot" };
  }

  const at = opts.at ?? new Date();

  const [account, config, telegramConfigs] = await Promise.all([
    prisma.account.findUnique({
      where: { id: opts.accountId },
      select: { timezone: true },
    }),
    prisma.surveillanceConfig.findUnique({
      where: { accountId: opts.accountId },
      include: { cameras: { select: { cameraId: true } } },
    }),
    prisma.telegramConfig.findMany({
      where: { accountId: opts.accountId, isActive: true },
      select: { botToken: true, chatId: true },
    }),
  ]);

  if (!config) return { sent: false, reason: "no-config" };
  if (!config.alertTelegram) return { sent: false, reason: "telegram-disabled" };
  if (telegramConfigs.length === 0) return { sent: false, reason: "no-telegram" };
  if (!isSurveillanceArmed(config, at, account?.timezone)) {
    return { sent: false, reason: "not-armed" };
  }
  if (type === "PERSON" && !config.alertOnPerson) {
    return { sent: false, reason: "person-disabled" };
  }
  if (type === "VEHICLE" && !config.alertOnVehicle) {
    return { sent: false, reason: "vehicle-disabled" };
  }

  const selected = new Set(config.cameras.map((c) => c.cameraId));
  if (selected.size === 0 || !selected.has(opts.cameraId)) {
    return { sent: false, reason: "camera-not-selected" };
  }

  const key = telegramKey(opts.cameraId, type);
  const lastMap = parseLastPushMap(config.lastPushByKey);
  const cooldownMs = Math.max(1, config.cooldownMinutes) * 60_000;
  const lastIso = lastMap[key];
  if (lastIso) {
    const last = Date.parse(lastIso);
    if (Number.isFinite(last) && at.getTime() - last < cooldownMs) {
      return { sent: false, reason: "cooldown" };
    }
  }

  let cameraName = opts.cameraName;
  if (!cameraName) {
    const cam = await prisma.camera.findFirst({
      where: { id: opts.cameraId, accountId: opts.accountId },
      select: { name: true },
    });
    cameraName = cam?.name ?? `Kamera ${opts.cameraId}`;
  }

  const label = type === "PERSON" ? "Person" : "Fahrzeug";
  const timeStr = new Intl.DateTimeFormat("de-DE", {
    timeZone: account?.timezone ?? "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(at);

  const detail = opts.detail?.trim();
  const caption = [
    `<b>Überwachung: ${escapeHtml(label)}</b>`,
    `${escapeHtml(cameraName)} · ${escapeHtml(timeStr)}`,
    detail ? escapeHtml(detail) : null,
  ]
    .filter(Boolean)
    .join("\n");

  let sentOk = 0;
  for (const tg of telegramConfigs) {
    try {
      const res = await sendTelegramPhoto(tg.botToken, tg.chatId, opts.snapshot, caption);
      if (res.ok) sentOk++;
      else console.error("[surveillance] telegram photo failed:", res.description);
    } catch (err) {
      console.error("[surveillance] telegram photo error:", err);
    }
  }

  lastMap[key] = at.toISOString();
  await prisma.surveillanceConfig.update({
    where: { id: config.id },
    data: { lastPushByKey: lastMap },
  });

  return { sent: sentOk > 0, reason: sentOk > 0 ? undefined : "telegram-failed" };
}
