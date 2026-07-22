import { loadConfig } from "./config";
import { doorbirdSnapshot } from "./doorbird";
import {
  tgSendMessage,
  tgSendPhoto,
  type TelegramBotInfo,
} from "./telegram";
import type { TelegramConfig, TelegramEventToggles } from "./types";

/**
 * High-Level-Notification-Dispatcher.
 *
 * Aufrufer benutzen `notify(type, payload)` und müssen sich um nichts
 * kümmern — Konfig laden, Toggle prüfen, Snapshot holen, an alle Chat-IDs
 * dispatchen, Fehler loggen — alles hier drin. Fire-and-forget freundlich.
 *
 * Wir blockieren niemals den Caller: wenn Telegram mal hängt darf der
 * Tür-Öffnen-Pfad nicht warten. Daher `void notify(...)` an den Hot-Paths.
 */

const FETCH_TIMEOUT_MS = 6000;

type NotifyType =
  | "door-open"
  | "door-ring"
  | "alpr-matched"
  | "alpr-unauthorized"
  | "alpr-cooldown";

interface DoorOpenPayload {
  source: "ui" | "alpr" | string;
  plate?: string;
  owner?: string;
  /** Wenn gesetzt: dieses Bild nutzen statt zweiten Doorbird-Fetch. */
  snapshot?: Buffer | null;
}

interface DoorRingPayload {
  snapshot?: Buffer | null;
}

interface AlprPayload {
  plate: string;
  owner?: string | null;
  confidence: number;
  /**
   * Bytes des Snapshots, die der Sidecar mitgeschickt hat (oder null
   * wenn der Aufrufer das Bild nicht zur Hand hatte). Wir laden nicht
   * neu, weil das Schild zwischenzeitlich weg sein könnte.
   */
  snapshot?: Buffer | null;
}

type Payload =
  | { type: "door-open"; data: DoorOpenPayload }
  | { type: "door-ring"; data: DoorRingPayload }
  | { type: "alpr-matched"; data: AlprPayload }
  | { type: "alpr-unauthorized"; data: AlprPayload }
  | { type: "alpr-cooldown"; data: AlprPayload };

function eventEnabled(
  events: TelegramEventToggles,
  type: NotifyType,
): boolean {
  switch (type) {
    case "door-open":
      return events.doorOpen;
    case "door-ring":
      return events.doorRing;
    case "alpr-matched":
      return events.alprMatched;
    case "alpr-unauthorized":
      return events.alprUnauthorized;
    case "alpr-cooldown":
      return events.alprCooldown;
    default:
      return false;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatTimestamp(): string {
  return new Date().toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildMessage(p: Payload): string {
  const ts = `<i>${escapeHtml(formatTimestamp())}</i>`;
  switch (p.type) {
    case "door-open": {
      if (p.data.source === "alpr" && p.data.plate) {
        const owner = p.data.owner
          ? ` · ${escapeHtml(p.data.owner)}`
          : "";
        return `🚪 <b>Tür geöffnet</b> via Kennzeichen\n<code>${escapeHtml(
          p.data.plate,
        )}</code>${owner}\n${ts}`;
      }
      return `🚪 <b>Tür geöffnet</b> (${escapeHtml(p.data.source)})\n${ts}`;
    }
    case "door-ring":
      return `🔔 <b>Es klingelt!</b>\n${ts}`;
    case "alpr-matched": {
      const owner = p.data.owner
        ? ` · ${escapeHtml(p.data.owner)}`
        : "";
      return `✅ <b>Whitelist-Plate erkannt</b>\n<code>${escapeHtml(
        p.data.plate,
      )}</code>${owner} · ${(p.data.confidence * 100).toFixed(0)}%\n${ts}`;
    }
    case "alpr-unauthorized":
      return `⚠️ <b>Unbekanntes Kennzeichen</b>\n<code>${escapeHtml(
        p.data.plate,
      )}</code> · ${(p.data.confidence * 100).toFixed(0)}%\n${ts}`;
    case "alpr-cooldown": {
      const owner = p.data.owner
        ? ` · ${escapeHtml(p.data.owner)}`
        : "";
      return `⏳ <b>Plate erkannt, Cooldown aktiv</b>\n<code>${escapeHtml(
        p.data.plate,
      )}</code>${owner}\n${ts}`;
    }
  }
}

async function fetchDoorbirdSnapshotSafe(): Promise<Buffer | null> {
  try {
    const cfg = await loadConfig();
    if (!cfg.doorbird.enabled || !cfg.doorbird.ip) return null;
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      return await doorbirdSnapshot(cfg.doorbird, ctl.signal);
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    console.warn("[notify] doorbird snapshot failed", (e as Error).message);
    return null;
  }
}

async function dispatch(
  cfg: TelegramConfig,
  text: string,
  jpeg: Buffer | null,
): Promise<void> {
  if (!cfg.enabled || !cfg.botToken || cfg.chatIds.length === 0) return;

  const useSnapshot = cfg.includeSnapshot && jpeg && jpeg.length > 0;

  // Pro Chat parallel — Telegram-Limits sind 30 msg/sec global, das hier
  // sind höchstens eine Handvoll IDs.
  await Promise.allSettled(
    cfg.chatIds.map(async (chatId) => {
      if (useSnapshot) {
        const r = await tgSendPhoto(cfg.botToken, chatId, jpeg, text);
        if (!r.ok) {
          console.warn(`[notify] telegram[${chatId}] sendPhoto: ${r.error}`);
          // Fallback: wenigstens den Text versuchen
          await tgSendMessage(cfg.botToken, chatId, text);
        }
      } else {
        const r = await tgSendMessage(cfg.botToken, chatId, text);
        if (!r.ok) {
          console.warn(`[notify] telegram[${chatId}] sendMessage: ${r.error}`);
        }
      }
    }),
  );
}

/**
 * Hot-Path-freundliches Notify. Aufrufer macht `void notify(...)` und
 * läuft sofort weiter — die Telegram-Calls passieren async im Hintergrund.
 *
 * Falls Telegram in Settings deaktiviert oder das Event aus, wird gar
 * nichts gemacht (auch kein Snapshot-Fetch).
 */
export async function notify(p: Payload): Promise<void> {
  try {
    const cfg = await loadConfig();
    const tg = cfg.settings.telegram;
    if (!tg.enabled || !tg.botToken || tg.chatIds.length === 0) return;
    if (!eventEnabled(tg.events, p.type)) return;

    const text = buildMessage(p);

    let jpeg: Buffer | null = null;
    if (tg.includeSnapshot) {
      // Door-Events holen sich frischen Snapshot vom Doorbird;
      // ALPR-Events bekommen das Bild vom Aufrufer mitgegeben.
      if (p.type === "door-open" || p.type === "door-ring") {
        const preload =
          p.type === "door-open"
            ? (p.data as DoorOpenPayload).snapshot
            : (p.data as DoorRingPayload).snapshot;
        if (preload !== undefined) jpeg = preload;
        else jpeg = await fetchDoorbirdSnapshotSafe();
      } else if (
        p.type === "alpr-matched" ||
        p.type === "alpr-unauthorized" ||
        p.type === "alpr-cooldown"
      ) {
        jpeg = p.data.snapshot ?? null;
      }
    }

    await dispatch(tg, text, jpeg);
  } catch (e) {
    console.error("[notify] dispatch failed", e);
  }
}

/**
 * Bot-Verbindung testen. Liefert Bot-Infos (Username) bei Erfolg, sonst
 * einen Fehlertext. Außerdem: schickt eine Test-Nachricht an alle Chat-IDs.
 */
export async function notifyTest(token: string, chatIds: string[]): Promise<{
  ok: boolean;
  bot?: TelegramBotInfo;
  error?: string;
  perChat: { chatId: string; ok: boolean; error?: string }[];
}> {
  const { tgGetMe } = await import("./telegram");
  const me = await tgGetMe(token);
  if (!me.ok) {
    return { ok: false, error: me.error, perChat: [] };
  }
  const perChat = await Promise.all(
    chatIds.map(async (chatId) => {
      const r = await tgSendMessage(
        token,
        chatId,
        `✅ <b>Webcams-Bot verbunden</b>\nDieser Chat erhält ab jetzt aktivierte Events.\n<i>${escapeHtml(
          formatTimestamp(),
        )}</i>`,
      );
      return { chatId, ok: r.ok, error: r.error };
    }),
  );
  const allOk = perChat.every((p) => p.ok);
  return { ok: allOk, bot: me.bot, perChat };
}
