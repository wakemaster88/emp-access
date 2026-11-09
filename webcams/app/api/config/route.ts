import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { ConfigSchema } from "@/lib/types";
import { ensureWorkersStarted } from "@/lib/people-counter";
import { requireAuth } from "@/lib/auth";
import { maskConfigSecrets, restoreConfigSecrets } from "@/lib/config-secrets";

export const dynamic = "force-dynamic";

export async function GET() {
  // Idempotent: startet Counter-Worker beim ersten Aufruf.
  await ensureWorkersStarted();
  const config = await loadConfig();
  // Alle Secrets maskieren (Passwörter, Admin-PIN, Bot-/API-Token,
  // Webhook-Secrets) — die Antwort geht an jeden Dashboard-Browser.
  return NextResponse.json(maskConfigSecrets(config));
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

  const parsed = ConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Maskierte Secrets ("***") aus der gespeicherten Config zurückholen —
  // ein Platzhalter darf nie ein echtes Secret überschreiben.
  const current = await loadConfig();
  const next = restoreConfigSecrets(parsed.data, current);

  const saved = await saveConfig(next);
  // Worker neu syncen (Cam evt. enabled/disabled, Intervall geändert)
  const { syncWorkers } = await import("@/lib/people-counter");
  await syncWorkers();
  // Python-Sidecar (Crossing-Counter) ebenfalls über Config-Änderung informieren.
  const { notifySidecarConfigChanged } = await import("@/lib/people-tracker");
  void notifySidecarConfigChanged();
  return NextResponse.json({ ok: true, version: saved.version });
}
