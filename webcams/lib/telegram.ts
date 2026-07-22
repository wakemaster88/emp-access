/**
 * Dünner Wrapper um die Telegram-Bot-API.
 *
 * Wir benutzen kein NPM-Package, weil die API trivial ist und wir sonst nur
 * eine weitere Dep im Build-Output hätten. Drei Endpoints reichen:
 *
 *   - sendMessage   Text mit optional Markdown
 *   - sendPhoto     JPEG-Buffer + optional Caption
 *   - getMe         für Token-Validierung im Test-Button
 *
 * Alle Methoden werfen niemals — sie liefern `{ ok, error }` und sollen
 * fire-and-forget aufrufbar sein, ohne den Hot-Path zu blockieren.
 */

const API = "https://api.telegram.org";

interface TelegramResult {
  ok: boolean;
  error?: string;
  description?: string;
}

interface RawTelegramResponse {
  ok: boolean;
  description?: string;
  error_code?: number;
  result?: unknown;
}

async function callJson(
  token: string,
  method: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<TelegramResult> {
  if (!token) return { ok: false, error: "no bot token" };
  try {
    const r = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const j = (await r.json()) as RawTelegramResponse;
    if (!j.ok) {
      return { ok: false, error: j.description ?? `HTTP ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function tgSendMessage(
  token: string,
  chatId: string,
  text: string,
  opts: { signal?: AbortSignal; disableNotification?: boolean } = {},
): Promise<TelegramResult> {
  return callJson(
    token,
    "sendMessage",
    {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: opts.disableNotification === true,
    },
    opts.signal,
  );
}

export async function tgSendPhoto(
  token: string,
  chatId: string,
  jpeg: Buffer | Uint8Array,
  caption: string,
  opts: { signal?: AbortSignal; disableNotification?: boolean } = {},
): Promise<TelegramResult> {
  if (!token) return { ok: false, error: "no bot token" };
  try {
    // Telegram akzeptiert das JPEG als multipart/form-data unter `photo`.
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    if (opts.disableNotification === true) {
      form.append("disable_notification", "true");
    }
    const blob = new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" });
    form.append("photo", blob, "snapshot.jpg");
    const r = await fetch(`${API}/bot${token}/sendPhoto`, {
      method: "POST",
      body: form,
      signal: opts.signal,
    });
    const j = (await r.json()) as RawTelegramResponse;
    if (!j.ok) {
      return { ok: false, error: j.description ?? `HTTP ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface TelegramBotInfo {
  id: number;
  username: string;
  first_name: string;
  is_bot: boolean;
  /** Wenn der Bot in Gruppen lesen darf (Privacy aus). */
  can_read_all_group_messages?: boolean;
}

export async function tgGetMe(
  token: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; bot?: TelegramBotInfo; error?: string }> {
  if (!token) return { ok: false, error: "no bot token" };
  try {
    const r = await fetch(`${API}/bot${token}/getMe`, { signal });
    const j = (await r.json()) as RawTelegramResponse & { result?: TelegramBotInfo };
    if (!j.ok) return { ok: false, error: j.description ?? `HTTP ${r.status}` };
    return { ok: true, bot: j.result };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface TelegramWebhookInfo {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
}

export async function tgGetWebhookInfo(
  token: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; result?: TelegramWebhookInfo; error?: string }> {
  if (!token) return { ok: false, error: "no bot token" };
  try {
    const r = await fetch(`${API}/bot${token}/getWebhookInfo`, {
      method: "POST",
      signal,
    });
    const j = (await r.json()) as RawTelegramResponse & {
      result?: TelegramWebhookInfo;
    };
    if (!j.ok) return { ok: false, error: j.description ?? `HTTP ${r.status}` };
    return { ok: true, result: j.result };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Registriert die Webhook-URL bei Telegram (`secret_token` = Header beim POST).
 */
export async function tgSetWebhook(
  token: string,
  webhookUrl: string,
  secretToken: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  if (!token) return { ok: false, error: "no bot token" };
  if (!secretToken.trim()) return { ok: false, error: "webhook secret missing" };
  try {
    const r = await fetch(`${API}/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secretToken,
        allowed_updates: ["message"],
      }),
      signal,
    });
    const j = (await r.json()) as RawTelegramResponse;
    if (!j.ok) return { ok: false, error: j.description ?? `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function tgDeleteWebhook(
  token: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  if (!token) return { ok: false, error: "no bot token" };
  try {
    const r = await fetch(`${API}/bot${token}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: false }),
      signal,
    });
    const j = (await r.json()) as RawTelegramResponse;
    if (!j.ok) return { ok: false, error: j.description ?? `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
