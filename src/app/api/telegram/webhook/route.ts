import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { answerCallbackQuery, editMessageCaption } from "@/lib/telegram";

/**
 * Telegram-Webhook: verarbeitet Inline-Button-Klicks (callback_query).
 *
 * Auth: Die Webhook-URL enthält ?token=<botToken>; wir akzeptieren nur
 * Updates, wenn ein aktiver TelegramConfig mit genau diesem Bot-Token
 * existiert und der Klick aus dem konfigurierten Chat kommt. Damit kann
 * niemand fremde Updates einschleusen (das Bot-Token kennt nur Telegram
 * selbst und der Account-Inhaber).
 *
 * Unterstützte Callbacks:
 *   door:<cameraId>  → DOORBIRD_OPEN-Hub-Task (Tor öffnen)
 */
export async function POST(request: NextRequest) {
  const botToken = request.nextUrl.searchParams.get("token") ?? "";
  if (!botToken) return NextResponse.json({ ok: true });

  const config = await prisma.telegramConfig.findFirst({
    where: { botToken, isActive: true },
    select: { accountId: true, chatId: true },
  });
  // Immer 200 antworten, sonst wiederholt Telegram das Update endlos.
  if (!config) return NextResponse.json({ ok: true });

  const update = (await request.json().catch(() => null)) as {
    callback_query?: {
      id: string;
      from?: { first_name?: string; last_name?: string; username?: string };
      message?: {
        message_id: number;
        chat: { id: number };
        caption?: string;
      };
      data?: string;
    };
  } | null;

  const cb = update?.callback_query;
  if (!cb?.data) return NextResponse.json({ ok: true });

  // Nur Klicks aus dem konfigurierten Chat akzeptieren.
  if (String(cb.message?.chat.id) !== String(config.chatId)) {
    await answerCallbackQuery(botToken, cb.id, "Nicht berechtigt.");
    return NextResponse.json({ ok: true });
  }

  const doorMatch = cb.data.match(/^door:(\d+)$/);
  if (doorMatch) {
    const cameraId = Number(doorMatch[1]);
    const camera = await prisma.camera.findFirst({
      where: { id: cameraId, accountId: config.accountId, kind: "DOORBIRD" },
      select: { id: true, name: true },
    });
    if (!camera) {
      await answerCallbackQuery(botToken, cb.id, "Kamera nicht gefunden.");
      return NextResponse.json({ ok: true });
    }

    await prisma.hubTask.create({
      data: {
        type: "DOORBIRD_OPEN",
        payload: { cameraId: camera.id, relay: 1 },
        accountId: config.accountId,
      },
    });

    await answerCallbackQuery(botToken, cb.id, "Tor wird geöffnet …");

    // Caption ergänzen + Button entfernen (verhindert Doppel-Klicks).
    if (cb.message) {
      const who =
        [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(" ") ||
        cb.from?.username ||
        "Unbekannt";
      const timeStr = new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date());
      const base = cb.message.caption ?? "Öffnungswunsch";
      await editMessageCaption(
        botToken,
        cb.message.chat.id,
        cb.message.message_id,
        `${base}\n✅ Tor geöffnet von ${who} um ${timeStr} Uhr`
      ).catch(() => undefined);
    }

    return NextResponse.json({ ok: true });
  }

  await answerCallbackQuery(botToken, cb.id);
  return NextResponse.json({ ok: true });
}
