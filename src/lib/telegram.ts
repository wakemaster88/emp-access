const BASE = "https://api.telegram.org/bot";

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode: "HTML" | "MarkdownV2" = "HTML"
): Promise<{ ok: boolean; description?: string }> {
  const res = await fetch(`${BASE}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    }),
  });
  return res.json();
}

/** Inline-Keyboard (Buttons unter der Nachricht). */
export interface TelegramInlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

/** Snapshot als Foto an einen Chat senden (Caption max. 1024 Zeichen). */
export async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  photo: Buffer | Uint8Array,
  caption?: string,
  parseMode: "HTML" | "MarkdownV2" = "HTML",
  replyMarkup?: TelegramInlineKeyboard
): Promise<{ ok: boolean; description?: string; result?: { message_id: number } }> {
  const form = new FormData();
  form.append("chat_id", chatId);
  const bytes = new Uint8Array(
    photo instanceof Uint8Array ? photo : new Uint8Array(photo)
  );
  form.append(
    "photo",
    new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], {
      type: "image/jpeg",
    }),
    "snapshot.jpg"
  );
  if (caption) {
    form.append("caption", caption.slice(0, 1024));
    form.append("parse_mode", parseMode);
  }
  if (replyMarkup) {
    form.append("reply_markup", JSON.stringify(replyMarkup));
  }
  const res = await fetch(`${BASE}${botToken}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  return res.json();
}

/** Antwort auf einen Inline-Button-Klick (kleines Toast beim Nutzer). */
export async function answerCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text?: string
): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
  return res.json();
}

/** Caption einer bestehenden Foto-Nachricht ändern (z.B. "Tor geöffnet"). */
export async function editMessageCaption(
  botToken: string,
  chatId: string | number,
  messageId: number,
  caption: string,
  replyMarkup?: TelegramInlineKeyboard
): Promise<{ ok: boolean; description?: string }> {
  const res = await fetch(`${BASE}${botToken}/editMessageCaption`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      caption: caption.slice(0, 1024),
      parse_mode: "HTML",
      reply_markup: replyMarkup ?? { inline_keyboard: [] },
    }),
  });
  return res.json();
}

/** Webhook für Bot-Updates registrieren (Callback-Buttons). */
export async function setTelegramWebhook(
  botToken: string,
  url: string
): Promise<{ ok: boolean; description?: string }> {
  const res = await fetch(`${BASE}${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, allowed_updates: ["callback_query", "message"] }),
  });
  return res.json();
}

export async function getMe(botToken: string): Promise<{ ok: boolean; result?: { username: string } }> {
  const res = await fetch(`${BASE}${botToken}/getMe`);
  return res.json();
}

export async function getUpdates(botToken: string): Promise<{
  ok: boolean;
  result?: { message?: { chat: { id: number; title?: string; type: string }; text?: string } }[];
}> {
  const res = await fetch(`${BASE}${botToken}/getUpdates?limit=10&offset=-10`);
  return res.json();
}
