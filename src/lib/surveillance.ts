/**
 * Überwachungsmodus: manuell und/oder per Zeitplan scharf,
 * Push bei PERSON/VEHICLE auf ausgewählten Kameras,
 * Telegram-Foto bei Sighting mit Snapshot.
 *
 * Sperrzeit je Kamera, Art und Kanal (surveillance-cooldown.ts): Sie wird vor
 * dem Senden in einer einzelnen Anweisung gesetzt, die nur den eigenen
 * Schlüssel schreibt; gesendet wird nur, wenn diese Anweisung die Zeile
 * geändert hat. Push und Telegram derselben Sichtung überschreiben sich so
 * nicht gegenseitig.
 *
 * Ein Meldeweg in der Nacht (hub-sentinel.ts): Belegt der Hub die Sichtung
 * als bewertet (`sentinel=1`) und bewacht sein Wächter die Kamera laut
 * frischer Meldung, unterbleibt die Meldung einer unbekannten Person hier
 * (Option `hubSentinel`, nur für unbekannte Personen mit Beleg). Jede so
 * unterbliebene Meldung steht im Log und wird je Hub gezählt.
 */
import { prisma } from "@/lib/prisma";
import { isWithinWindow } from "@/lib/tz-time";
import { sendTelegramPhoto } from "@/lib/telegram";
import { sendPushToAccount } from "@/lib/web-push";
import {
  COOLDOWN_ISO_SQL,
  claimCooldown,
  cooldownOpen,
  type CooldownStore,
} from "@/lib/surveillance-cooldown";
import { HUB_SENTINEL_LOG_TAG, coveringHub, mutedLine } from "@/lib/hub-sentinel";
import { sendToAllChats } from "@/lib/surveillance-send";

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
    return isWithinWindow(now, config.windowStart, config.windowEnd, timezone);
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
 * Sperrzeit in der Datenbank: eine Anweisung, die nur `key` in
 * lastPushByKey schreibt, und nur, wenn er fehlt, kein Zeitpunkt ist oder
 * höchstens `notAfterIso` (Zeitpunkte im Format von toISOString, Vergleich
 * mit Sortierung "C"). Ist lastPushByKey leer oder kein Objekt, entsteht ein
 * neues. updatedAt wird wie bei jedem Schreiben über Prisma gesetzt.
 */
const cooldownStore: CooldownStore = {
  claim: (configId, key, iso, notAfterIso) => prisma.$executeRaw`
    UPDATE "SurveillanceConfig"
    SET "lastPushByKey" =
          (CASE WHEN jsonb_typeof("lastPushByKey") = 'object' THEN "lastPushByKey" ELSE '{}'::jsonb END)
          || jsonb_build_object(${key}::text, ${iso}::text),
        "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "id" = ${configId}
      AND (
        jsonb_typeof("lastPushByKey" -> ${key}::text) IS DISTINCT FROM 'string'
        OR ("lastPushByKey" ->> ${key}::text) !~ ${COOLDOWN_ISO_SQL}::text
        OR ("lastPushByKey" ->> ${key}::text) COLLATE "C" <= ${notAfterIso}::text COLLATE "C"
      )
  `,
};

/** Hub, dessen Wächter die Kamera gerade bewacht, und das Alter seiner Meldung. */
export interface HubSentinelCover {
  hubId: number;
  hubName: string;
  ageMs: number;
}

/**
 * Abfrage für eine Sichtung: Bewacht der Wächter eines Hubs des Kontos die
 * Kamera nachweislich (coveringHub)? Gelesen wird nur HubAgent.status.sentinel,
 * höchstens einmal je Sichtung. Scheitert die Abfrage, gilt die Kamera als
 * nicht bewacht: Die Cloud meldet dann selbst.
 */
export function hubSentinelLookup(accountId: number, cameraId: number): () => Promise<HubSentinelCover | null> {
  let pending: Promise<HubSentinelCover | null> | null = null;
  return () =>
    (pending ??= prisma.$queryRaw<Array<{ id: number; name: string; sentinel: unknown }>>`
      SELECT "id", "name", "status" -> 'sentinel' AS "sentinel" FROM "HubAgent" WHERE "accountId" = ${accountId}
    `
      .then((rows) => {
        const hubs = rows.map((r) => ({ id: r.id, name: r.name, status: { sentinel: r.sentinel } }));
        const hit = coveringHub(hubs, cameraId, new Date());
        return hit ? { hubId: hit.hub.id, hubName: hit.hub.name, ageMs: hit.ageMs } : null;
      })
      .catch((err) => {
        console.error(`${HUB_SENTINEL_LOG_TAG} account=${accountId} Kamera ${cameraId}: Abfrage fehlgeschlagen, Cloud meldet selbst:`, err);
        return null;
      }));
}

/**
 * Zähler der unterbliebenen Meldungen am Hub (HubAgent.status.sentinelMuted),
 * in einer Anweisung hochgezählt; liefert den neuen Stand. Das Lebenszeichen
 * ersetzt nur seine eigenen Schlüssel, der Zähler bleibt stehen.
 */
async function countMuted(hubId: number, cameraId: number, channel: string, at: Date): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ count: string | null }>>`
    UPDATE "HubAgent"
    SET "status" = jsonb_set(
      CASE WHEN jsonb_typeof("status") = 'object' THEN "status" ELSE '{}'::jsonb END,
      '{sentinelMuted}',
      jsonb_build_object(
        'count',
        (CASE WHEN jsonb_typeof("status" -> 'sentinelMuted' -> 'count') = 'number'
          THEN ("status" -> 'sentinelMuted' ->> 'count')::numeric ELSE 0 END) + 1,
        'lastAt', ${at.toISOString()}::text,
        'lastCameraId', ${cameraId}::int,
        'lastChannel', ${channel}::text
      ),
      true
    )
    WHERE "id" = ${hubId}
    RETURNING "status" -> 'sentinelMuted' ->> 'count' AS "count"
  `;
  const n = Number(rows[0]?.count);
  return Number.isFinite(n) ? n : null;
}

/**
 * Unterbleibt diese Meldung, weil der Wächter des Hubs die Kamera bewacht?
 * Dann steht sie mit Kamera und Grund im Log und wird gezählt. Ein Fehler
 * beim Zählen ändert die Entscheidung nicht.
 */
async function mutedByHubSentinel(
  lookup: (() => Promise<HubSentinelCover | null>) | undefined,
  opts: { accountId: number; cameraId: number; channel: "Push" | "Telegram"; at: Date },
): Promise<boolean> {
  if (!lookup) return false;
  const cover = await lookup();
  if (!cover) return false;
  const count = await countMuted(cover.hubId, opts.cameraId, opts.channel, opts.at).catch((err) => {
    console.error(`${HUB_SENTINEL_LOG_TAG} account=${opts.accountId}: Zähler nicht geschrieben:`, err);
    return null;
  });
  console.log(mutedLine({ ...opts, hubName: cover.hubName, ageMs: cover.ageMs, count }));
  return true;
}

/**
 * Sendet ggf. einen Überwachungs-Push.
 * Sperrzeit pro Kamera+Typ (`cameraId:TYPE`).
 * PERSON-Alerts kommen aus der Face-Sichtung (nicht vom KI-Event-Start),
 * damit Whitelist-Personen still bleiben.
 */
export async function maybeSurveillanceAlert(opts: {
  accountId: number;
  cameraId: number;
  type: string;
  cameraName?: string | null;
  at?: Date;
  /**
   * Unbekannte Person mit Beleg des Hubs: unterbleibt, wenn der Wächter des
   * Hubs die Kamera bewacht (hubSentinelLookup). Fehlt bei Fahrzeugen,
   * gesperrten Personen und Sichtungen ohne Beleg.
   */
  hubSentinel?: () => Promise<HubSentinelCover | null>;
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
  if (!cooldownOpen(parseLastPushMap(config.lastPushByKey), key, at, config.cooldownMinutes)) {
    return { sent: false, reason: "cooldown" };
  }
  // Der Wächter des Hubs bewacht die Kamera: Er meldet die Person, die Cloud nicht.
  if (await mutedByHubSentinel(opts.hubSentinel, { accountId: opts.accountId, cameraId: opts.cameraId, channel: "Push", at })) {
    return { sent: false, reason: "hub-sentinel" };
  }
  // Entschieden wird erst hier: Nur wer die Sperrzeit setzt, sendet.
  const claimed = await claimCooldown(cooldownStore, {
    configId: config.id,
    key,
    at,
    minutes: config.cooldownMinutes,
  });
  if (!claimed) return { sent: false, reason: "cooldown" };

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

  return { sent: result.sent > 0, reason: result.sent > 0 ? undefined : "no-subscribers" };
}

/**
 * Sendet ggf. Telegram-Foto bei Sighting mit Snapshot.
 * Eigene Sperrzeit (`tg:cameraId:TYPE`), unabhängig vom Web-Push.
 */
export async function maybeSurveillanceTelegramAlert(opts: {
  accountId: number;
  cameraId: number;
  type: string;
  snapshot: Buffer | Uint8Array;
  cameraName?: string | null;
  detail?: string | null;
  at?: Date;
  /** Wie bei maybeSurveillanceAlert. */
  hubSentinel?: () => Promise<HubSentinelCover | null>;
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
  if (!cooldownOpen(parseLastPushMap(config.lastPushByKey), key, at, config.cooldownMinutes)) {
    return { sent: false, reason: "cooldown" };
  }
  // Der Wächter des Hubs bewacht die Kamera: Er meldet die Person, die Cloud nicht.
  if (await mutedByHubSentinel(opts.hubSentinel, { accountId: opts.accountId, cameraId: opts.cameraId, channel: "Telegram", at })) {
    return { sent: false, reason: "hub-sentinel" };
  }
  // Entschieden wird erst hier: Nur wer die Sperrzeit setzt, sendet.
  const claimed = await claimCooldown(cooldownStore, {
    configId: config.id,
    key,
    at,
    minutes: config.cooldownMinutes,
  });
  if (!claimed) return { sent: false, reason: "cooldown" };

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

  // Alle Chats nebeneinander: Die Sichtungs-Route wartet auf die Sendung (surveillance-send.ts).
  const sentOk = await sendToAllChats(
    telegramConfigs,
    (tg) => sendTelegramPhoto(tg.botToken, tg.chatId, opts.snapshot, caption),
    (_tg, why) =>
      why.error !== undefined
        ? console.error("[surveillance] telegram photo error:", why.error)
        : console.error("[surveillance] telegram photo failed:", why.description),
  );

  return { sent: sentOk > 0, reason: sentOk > 0 ? undefined : "telegram-failed" };
}
