import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { tgSendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** Telegram sendet Header `X-Telegram-Bot-Api-Secret-Token` wenn bei setWebhook gesetzt. */
const SECRET_HDR = "x-telegram-bot-api-secret-token";

interface TgChat {
  id: number;
  type?: string;
}

interface TgMsg {
  message_id: number;
  chat: TgChat;
  text?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMsg;
  edited_message?: TgMsg;
}

function welcomeHtml(chatId: number): string {
  return (
    `<b>Hallo!</b>\n\n` +
    `Deine Chat-ID: <code>${chatId}</code>\n\n` +
    `Trage diese unter <i>Einstellungen → Telegram → Chat-IDs</i> ein und speichere.\n\n` +
    `Danach erhältst du Benachrichtigungen für Tür/ALPR-Events (je nach aktivierten Ereignissen).`
  );
}

/**
 * Empfängt Telegram-Updates (z. B. /start). Erfordert registrierten Webhook mit Secret.
 */
export async function POST(req: Request) {
  const cfg = await loadConfig();
  const expected = cfg.settings.telegram.webhookSecret?.trim();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "Webhook nicht konfiguriert" },
      { status: 503 },
    );
  }

  const got = req.headers.get(SECRET_HDR)?.trim();
  if (got !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const msg = update.message ?? update.edited_message;
  const text = msg?.text?.trim();
  if (!msg || !text?.startsWith("/start")) {
    return NextResponse.json({ ok: true });
  }

  const token = cfg.settings.telegram.botToken?.trim();
  if (!token) {
    return NextResponse.json({ ok: true });
  }

  const chatId = msg.chat.id;
  void tgSendMessage(token, String(chatId), welcomeHtml(chatId));

  return NextResponse.json({ ok: true });
}
