import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { answerCallbackQuery, editMessageCaption, editMessageText, telegramWebhookSecret } from "@/lib/telegram";
import { approveVereinRequest, rejectVereinRequest } from "@/lib/verein-portal";
import { loadRequestSummary, requestTelegramText, VEREIN_REQUEST_CALLBACK_RE } from "@/lib/verein-request-telegram";
import { secretsEqual } from "@/lib/cron-auth";

/**
 * Telegram-Webhook: verarbeitet Inline-Button-Klicks (callback_query).
 *
 * Auth: Die Webhook-URL traegt nur noch die Config-ID (`?id=`). Telegram
 * schickt den bei setWebhook hinterlegten `secret_token` im Header
 * `X-Telegram-Bot-Api-Secret-Token` mit; er wird aus dem Bot-Token und
 * AUTH_SECRET abgeleitet (siehe telegramWebhookSecret). Damit steht das
 * Bot-Token nicht mehr in URL und Request-Logs.
 *
 * Uebergang: Alte Registrierungen mit `?token=<botToken>` funktionieren
 * weiter, bis `npx tsx scripts/telegram-webhook-setup.ts` gelaufen ist.
 *
 * Unterstützte Callbacks:
 *   door:<cameraId>  → DOORBIRD_OPEN-Hub-Task (Tor öffnen)
 *   vreq:ok:<id>     → Wunschzeit-Anfrage eines Vereins freigeben
 *   vreq:no:<id>     → Wunschzeit-Anfrage ablehnen
 */
type WebhookConfig = { accountId: number; chatId: string; botToken: string };

async function resolveConfig(request: NextRequest): Promise<WebhookConfig | null> {
  const idParam = request.nextUrl.searchParams.get("id");
  if (idParam) {
    const id = Number(idParam);
    if (!Number.isInteger(id)) return null;
    const config = await prisma.telegramConfig.findFirst({
      where: { id, isActive: true },
      select: { accountId: true, chatId: true, botToken: true },
    });
    if (!config) return null;
    const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!header || !secretsEqual(header, telegramWebhookSecret(config.botToken))) return null;
    return config;
  }

  const botToken = request.nextUrl.searchParams.get("token") ?? "";
  if (!botToken) return null;
  const config = await prisma.telegramConfig.findFirst({
    where: { botToken, isActive: true },
    select: { accountId: true, chatId: true, botToken: true },
  });
  if (config) {
    console.warn("[telegram webhook] Aufruf mit Bot-Token in der URL – bitte scripts/telegram-webhook-setup.ts ausfuehren.");
  }
  return config;
}

export async function POST(request: NextRequest) {
  const config = await resolveConfig(request);
  // Immer 200 antworten, sonst wiederholt Telegram das Update endlos.
  if (!config) return NextResponse.json({ ok: true });
  const botToken = config.botToken;

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

  const vreqMatch = cb.data.match(VEREIN_REQUEST_CALLBACK_RE);
  if (vreqMatch) {
    const approve = vreqMatch[1] === "ok";
    const requestId = Number(vreqMatch[2]);
    const who =
      [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(" ") ||
      cb.from?.username ||
      "Telegram";
    const result = approve
      ? await approveVereinRequest(config.accountId, requestId)
      : await rejectVereinRequest(config.accountId, requestId, null);
    await answerCallbackQuery(
      botToken,
      cb.id,
      result.ok ? (approve ? "Freigegeben, Slot ist gebucht." : "Abgelehnt.") : result.error,
    );

    if (cb.message) {
      const summary = await loadRequestSummary(config.accountId, requestId).catch(() => null);
      const base = summary ? requestTelegramText(summary) : "Anfrage";
      const timeStr = new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date());
      const status = result.ok
        ? `${approve ? "✅ Freigegeben" : "❌ Abgelehnt"} von ${who} um ${timeStr} Uhr`
        : `⚠️ ${result.error}`;
      // Bei Fehlern (z. B. Slot inzwischen belegt) bleiben die Tasten stehen,
      // ausser die Anfrage ist schon entschieden.
      const decided = result.ok || result.status === 404;
      await editMessageText(
        botToken,
        cb.message.chat.id,
        cb.message.message_id,
        `${base}\n${status}`,
        decided ? undefined : {
          inline_keyboard: [[
            { text: "✅ Freigeben", callback_data: `vreq:ok:${requestId}` },
            { text: "❌ Ablehnen", callback_data: `vreq:no:${requestId}` },
          ]],
        },
      ).catch(() => undefined);
    }
    return NextResponse.json({ ok: true });
  }

  await answerCallbackQuery(botToken, cb.id);
  return NextResponse.json({ ok: true });
}
