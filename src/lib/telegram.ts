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

/** Snapshot als Foto an einen Chat senden (Caption max. 1024 Zeichen). */
export async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  photo: Buffer | Uint8Array,
  caption?: string,
  parseMode: "HTML" | "MarkdownV2" = "HTML"
): Promise<{ ok: boolean; description?: string }> {
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
  const res = await fetch(`${BASE}${botToken}/sendPhoto`, {
    method: "POST",
    body: form,
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
