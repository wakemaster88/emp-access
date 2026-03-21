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
