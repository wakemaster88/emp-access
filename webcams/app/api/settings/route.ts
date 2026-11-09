import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { SettingsSchema } from "@/lib/types";
import { requireAuth } from "@/lib/auth";
import { maskSettingsSecrets, restoreSettingsSecrets } from "@/lib/config-secrets";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await loadConfig();
  return NextResponse.json(maskSettingsSecrets(config.settings));
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
  // Secrets werden maskiert ausgeliefert ("***"); beim Speichern darf der
  // Platzhalter den echten Wert nicht überschreiben (adminPin, Bot-Token,
  // API-Token, Webhook-Secrets).
  const next = {
    ...config,
    settings: restoreSettingsSecrets(parsed.data, config.settings),
  };
  await saveConfig(next);
  return NextResponse.json({ ok: true });
}
