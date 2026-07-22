import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { sendTelegramPhoto } from "@/lib/telegram";

/**
 * Öffnungswunsch am Tor (Token-Auth, vom Hub):
 * Der Hub schickt einen DoorBird-Schnappschuss, wenn ein Fahrzeug vor dem
 * Tor steht (MOTION + Vision-Check) oder geklingelt wird. Wir senden das
 * Foto per Telegram mit Inline-Button "Tor öffnen" – der Klick landet im
 * Telegram-Webhook und legt einen DOORBIRD_OPEN-Task an.
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const cameraId = Number(request.nextUrl.searchParams.get("cameraId"));
  if (!Number.isInteger(cameraId)) {
    return NextResponse.json({ error: "cameraId fehlt" }, { status: 400 });
  }
  const trigger = request.nextUrl.searchParams.get("trigger") === "DOORBELL"
    ? "DOORBELL"
    : "MOTION";

  const camera = await db.camera.findFirst({
    where: { id: cameraId, accountId: account.id, kind: "DOORBIRD" },
    select: { id: true, name: true },
  });
  if (!camera) {
    return NextResponse.json({ error: "DoorBird nicht gefunden" }, { status: 404 });
  }

  const body = Buffer.from(await request.arrayBuffer());
  if (body.length < 100) {
    return NextResponse.json({ error: "Kein Bild" }, { status: 400 });
  }

  const telegramConfigs = await db.telegramConfig.findMany({
    where: { accountId: account.id, isActive: true },
    select: { botToken: true, chatId: true },
  });
  if (telegramConfigs.length === 0) {
    return NextResponse.json({ sent: 0, reason: "no-telegram" });
  }

  const timeStr = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  const title = trigger === "DOORBELL" ? "🔔 Klingel am Tor" : "🚗 Fahrzeug am Tor";
  const caption = `<b>${title}</b>\n${camera.name} · ${timeStr} Uhr`;

  let sent = 0;
  for (const tg of telegramConfigs) {
    try {
      const res = await sendTelegramPhoto(tg.botToken, tg.chatId, body, caption, "HTML", {
        inline_keyboard: [
          [{ text: "🚪 Tor öffnen", callback_data: `door:${camera.id}` }],
        ],
      });
      if (res.ok) sent++;
      else console.error("[doorbird-gate] telegram failed:", res.description);
    } catch (err) {
      console.error("[doorbird-gate] telegram error:", err);
    }
  }

  return NextResponse.json({ sent });
}
