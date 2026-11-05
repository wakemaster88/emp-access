/**
 * Telegram-Bot des Hub-Assistenten (eigener Bot, nicht der Alarm-Bot der Cloud).
 *
 * Long Polling (`getUpdates`) vom Hub aus: keine eingehende Verbindung, kein
 * Webhook, laeuft auch wenn die Cloud nicht erreichbar ist. Ein Bot kann nur
 * einen Empfangsweg haben – deshalb ein eigener Bot fuer den Assistenten.
 */
import { log } from "../config.js";

const TOKEN = (process.env.HUB_AGENT_TELEGRAM_TOKEN || "").trim();
const MAX_TEXT = 4000;

export function telegramConfigured(): boolean {
  return /^\d+:[\w-]{20,}$/.test(TOKEN);
}

export interface TgButton {
  text: string;
  callback_data: string;
}

export interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { first_name?: string; last_name?: string; username?: string };
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string; width: number }>;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number }; text?: string };
  };
}

async function call<T>(method: string, body: Record<string, unknown> | FormData, timeoutMs = 20_000): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: isForm ? undefined : { "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? `HTTP ${res.status}`}`);
  return json.result as T;
}

/** Text in Telegram-taugliche Stuecke schneiden (an Zeilenenden). */
export function chunkText(text: string, max = MAX_TEXT): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

export async function sendText(chatId: string, text: string, buttons?: TgButton[][]): Promise<number | null> {
  let last: number | null = null;
  const parts = chunkText(text || "…");
  for (let i = 0; i < parts.length; i++) {
    const markup = i === parts.length - 1 && buttons ? { reply_markup: { inline_keyboard: buttons } } : {};
    const r = await call<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text: parts[i],
      disable_web_page_preview: true,
      ...markup,
    });
    last = r.message_id;
  }
  return last;
}

export async function sendPhoto(chatId: string, jpeg: Buffer, caption?: string): Promise<void> {
  const form = new FormData();
  form.set("chat_id", chatId);
  if (caption) form.set("caption", caption.slice(0, 1000));
  form.set("photo", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "bild.jpg");
  await call("sendPhoto", form, 60_000);
}

export async function editText(chatId: string, messageId: number, text: string): Promise<void> {
  await call("editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, MAX_TEXT) }).catch((e) =>
    log(`Assistent: ${e instanceof Error ? e.message : e}`)
  );
}

export async function answerCallback(id: string, text?: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: id, text }).catch(() => undefined);
}

export async function typing(chatId: string): Promise<void> {
  await call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
}

/** Groesstes Foto einer Nachricht als JPEG laden (fuer Bildfragen an das Modell). */
export async function downloadPhoto(photo: Array<{ file_id: string; width: number }>): Promise<Buffer | null> {
  const best = [...photo].sort((a, b) => b.width - a.width)[0];
  if (!best) return null;
  const file = await call<{ file_path?: string }>("getFile", { file_id: best.file_id });
  if (!file.file_path) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`, { signal: AbortSignal.timeout(30_000) });
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

export async function setCommands(): Promise<void> {
  await call("setMyCommands", {
    commands: [
      { command: "status", description: "Lage des Hubs" },
      { command: "befunde", description: "Offene Befunde des Wächters" },
      { command: "bericht", description: "Tagesbericht jetzt erstellen" },
      { command: "neu", description: "Gespräch neu beginnen" },
    ],
  }).catch((e) => log(`Assistent: ${e instanceof Error ? e.message : e}`));
}

let offset = 0;

/** Long Polling – blockiert bis zu 50 s, liefert neue Updates. */
export async function pollUpdates(): Promise<TgUpdate[]> {
  const updates = await call<TgUpdate[]>(
    "getUpdates",
    { offset, timeout: 50, allowed_updates: ["message", "callback_query"] },
    65_000
  );
  for (const u of updates) offset = Math.max(offset, u.update_id + 1);
  return updates;
}
