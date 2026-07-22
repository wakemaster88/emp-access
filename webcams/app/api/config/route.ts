import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { ConfigSchema } from "@/lib/types";
import { ensureWorkersStarted } from "@/lib/people-counter";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  // Idempotent: startet Counter-Worker beim ersten Aufruf.
  await ensureWorkersStarted();
  const config = await loadConfig();
  // Strip secrets before returning to clients
  const safe = {
    ...config,
    cams: config.cams.map((c) => ({ ...c, password: c.password ? "***" : "" })),
    doorbird: {
      ...config.doorbird,
      password: config.doorbird.password ? "***" : "",
      webhookSecret: config.doorbird.webhookSecret ? "***" : "",
    },
  };
  return NextResponse.json(safe);
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

  // Restore masked secrets from existing config if value is "***"
  const current = await loadConfig();
  const next = parsed.data;
  next.cams = next.cams.map((c) => {
    if (c.password === "***") {
      const prev = current.cams.find((p) => p.id === c.id);
      if (prev) return { ...c, password: prev.password };
    }
    return c;
  });
  if (next.doorbird.password === "***") {
    next.doorbird.password = current.doorbird.password;
  }
  if (next.doorbird.webhookSecret === "***") {
    next.doorbird.webhookSecret = current.doorbird.webhookSecret;
  }

  const saved = await saveConfig(next);
  // Worker neu syncen (Cam evt. enabled/disabled, Intervall geändert)
  const { syncWorkers } = await import("@/lib/people-counter");
  await syncWorkers();
  // Python-Sidecar (Crossing-Counter) ebenfalls über Config-Änderung informieren.
  const { notifySidecarConfigChanged } = await import("@/lib/people-tracker");
  void notifySidecarConfigChanged();
  return NextResponse.json({ ok: true, version: saved.version });
}
