import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { sendTelegramMessage, getMe, getUpdates } from "@/lib/telegram";
import { buildTelegramDailyReport } from "@/lib/telegram-daily-report";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const configs = await session.db.telegramConfig.findMany({
    where: { accountId: session.accountId! },
    select: {
      id: true,
      chatId: true,
      isActive: true,
      dailyReport: true,
      dailyReportTime: true,
      createdAt: true,
    },
  });

  return NextResponse.json(configs);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const { action } = body;

  if (action === "validate") {
    const botToken = body.botToken as string;
    if (!botToken) return NextResponse.json({ error: "Bot-Token erforderlich" }, { status: 400 });

    const me = await getMe(botToken);
    if (!me.ok) return NextResponse.json({ error: "Ungültiger Bot-Token" }, { status: 400 });

    const updates = await getUpdates(botToken);
    const chats: { id: number; title: string; type: string }[] = [];
    const seen = new Set<number>();
    for (const u of updates.result ?? []) {
      const chat = u.message?.chat;
      if (chat && !seen.has(chat.id)) {
        seen.add(chat.id);
        chats.push({ id: chat.id, title: chat.title ?? `Chat ${chat.id}`, type: chat.type });
      }
    }

    return NextResponse.json({ ok: true, botUsername: me.result?.username, chats });
  }

  if (action === "save") {
    const { botToken, chatId, dailyReport, dailyReportTime } = body;
    if (!botToken || !chatId) {
      return NextResponse.json({ error: "Bot-Token und Chat-ID erforderlich" }, { status: 400 });
    }

    const existing = await session.db.telegramConfig.findFirst({
      where: { accountId: session.accountId! },
    });

    if (existing) {
      await session.db.telegramConfig.update({
        where: { id: existing.id },
        data: {
          botToken,
          chatId: String(chatId),
          dailyReport: dailyReport ?? true,
          dailyReportTime: dailyReportTime ?? "20:00",
          isActive: true,
        },
      });
    } else {
      await session.db.telegramConfig.create({
        data: {
          botToken,
          chatId: String(chatId),
          dailyReport: dailyReport ?? true,
          dailyReportTime: dailyReportTime ?? "20:00",
          accountId: session.accountId!,
        },
      });
    }

    return NextResponse.json({ ok: true });
  }

  if (action === "test") {
    const config = await session.db.telegramConfig.findFirst({
      where: { accountId: session.accountId!, isActive: true },
    });
    if (!config) return NextResponse.json({ error: "Kein Telegram konfiguriert" }, { status: 404 });

    const report = await buildTelegramDailyReport(session.accountId!);
    const body =
      `🧪 <i>Testsendung – gleicher Inhalt wie der geplante Tagesbericht</i>\n\n` + report;
    const res = await sendTelegramMessage(config.botToken, config.chatId, body);

    return NextResponse.json(res);
  }

  if (action === "delete") {
    await session.db.telegramConfig.deleteMany({
      where: { accountId: session.accountId! },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });
}
