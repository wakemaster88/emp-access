import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { SettingsSchema } from "@/lib/types";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await loadConfig();
  return NextResponse.json({
    ...config.settings,
    adminPin: config.settings.adminPin ? "***" : "",
    telegram: {
      ...config.settings.telegram,
      botToken: config.settings.telegram.botToken ? "***" : "",
      webhookSecret: config.settings.telegram.webhookSecret ? "***" : "",
    },
    empAccess: {
      ...config.settings.empAccess,
      apiToken: config.settings.empAccess.apiToken ? "***" : "",
      webhookSecret: config.settings.empAccess.webhookSecret ? "***" : "",
    },
  });
}

export async function PUT(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = SettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const config = await loadConfig();
  const next = { ...config, settings: parsed.data };
  if (next.settings.adminPin === "***") next.settings.adminPin = config.settings.adminPin;
  // Bot-Token wird maskiert ausgeliefert ("***"), beim Speichern darf das
  // den echten Token nicht überschreiben — analog zu adminPin/Doorbird-PW.
  if (next.settings.telegram.botToken === "***") {
    next.settings.telegram.botToken = config.settings.telegram.botToken;
  }
  if (next.settings.telegram.webhookSecret === "***") {
    next.settings.telegram.webhookSecret = config.settings.telegram.webhookSecret;
  }
  if (next.settings.empAccess.apiToken === "***") {
    next.settings.empAccess.apiToken = config.settings.empAccess.apiToken;
  }
  if (next.settings.empAccess.webhookSecret === "***") {
    next.settings.empAccess.webhookSecret =
      config.settings.empAccess.webhookSecret;
  }
  await saveConfig(next);
  return NextResponse.json({ ok: true });
}
