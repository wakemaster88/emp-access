import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import {
  tgDeleteWebhook,
  tgGetWebhookInfo,
  tgSetWebhook,
} from "@/lib/telegram";

export const dynamic = "force-dynamic";

interface Body {
  /** Öffentliche Basis-URL der App, z. B. https://cam.example.com (HTTPS, von Telegram erreichbar). */
  publicBaseUrl?: string;
  /** Wenn true: Webhook bei Telegram löschen (Chat-ID-Eintrag bleibt). */
  delete?: boolean;
  /** Optionaler Token wie bei /api/notify/test — sonst gespeicherter Token. */
  botToken?: string;
}

function normalizeBase(url: string): string {
  const t = url.trim().replace(/\/+$/, "");
  return t;
}

function webhookPath(base: string): string {
  return `${normalizeBase(base)}/api/telegram/webhook`;
}

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = ((await req.json()) as Body) ?? {};
  } catch {
    body = {};
  }

  const config = await loadConfig();
  const stored = config.settings.telegram;
  const tokenInput = body.botToken;
  const token =
    !tokenInput || tokenInput === "***" ? stored.botToken : tokenInput;

  if (!token?.trim()) {
    return NextResponse.json(
      { ok: false, error: "Bot-Token fehlt" },
      { status: 400 },
    );
  }

  if (body.delete === true) {
    const del = await tgDeleteWebhook(token.trim());
    if (!del.ok) {
      return NextResponse.json(
        { ok: false, error: del.error ?? "deleteWebhook fehlgeschlagen" },
        { status: 502 },
      );
    }
    const info = await tgGetWebhookInfo(token.trim());
    return NextResponse.json({ ok: true, webhook: info.result ?? null });
  }

  const rawBase = body.publicBaseUrl?.trim();
  if (!rawBase) {
    return NextResponse.json(
      { ok: false, error: "publicBaseUrl fehlt (öffentliche HTTPS-URL)" },
      { status: 400 },
    );
  }

  const baseNorm = normalizeBase(rawBase);
  if (!baseNorm.startsWith("https://")) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Telegram akzeptiert nur HTTPS-Webhooks (Ausnahme: lokale Tests fallen bei Telegram ohnehin durch).",
      },
      { status: 400 },
    );
  }

  let secret = stored.webhookSecret?.trim();
  if (!secret) {
    secret = randomBytes(24).toString("hex");
    await saveConfig({
      ...config,
      settings: {
        ...config.settings,
        telegram: {
          ...config.settings.telegram,
          webhookSecret: secret,
        },
      },
    });
  }

  const url = webhookPath(baseNorm);
  const set = await tgSetWebhook(token.trim(), url, secret);
  if (!set.ok) {
    return NextResponse.json(
      { ok: false, error: set.error ?? "setWebhook fehlgeschlagen", webhookUrl: url },
      { status: 502 },
    );
  }

  const info = await tgGetWebhookInfo(token.trim());
  return NextResponse.json({
    ok: true,
    webhookUrl: url,
    webhook: info.result ?? null,
  });
}
