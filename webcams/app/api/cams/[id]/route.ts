import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { CamSchema } from "@/lib/types";
import { writeGo2rtcYaml, reloadGo2rtc } from "@/lib/go2rtc";
import { invalidateToken } from "@/lib/reolink";
import { syncWorkers } from "@/lib/people-counter";
import { notifySidecarConfigChanged } from "@/lib/people-tracker";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const config = await loadConfig();
  const cam = config.cams.find((c) => c.id === id);
  if (!cam) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ...cam, password: cam.password ? "***" : "" });
}

export async function PUT(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = CamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const config = await loadConfig();
  const idx = config.cams.findIndex((c) => c.id === id);
  if (idx === -1) return NextResponse.json({ error: "not found" }, { status: 404 });

  const incoming = parsed.data;
  // Restore masked password
  if (incoming.password === "***") {
    incoming.password = config.cams[idx].password;
  }
  // Forbid renaming the id (use delete + create instead)
  if (incoming.id !== id) {
    return NextResponse.json({ error: "id mismatch" }, { status: 400 });
  }

  const next = {
    ...config,
    cams: config.cams.map((c, i) => (i === idx ? incoming : c)),
  };
  await saveConfig(next);
  invalidateToken(id);
  await writeGo2rtcYaml(next);
  await reloadGo2rtc(next.settings.go2rtcUrl);
  await syncWorkers();
  void notifySidecarConfigChanged();
  return NextResponse.json({ ok: true, cam: { ...incoming, password: "***" } });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const config = await loadConfig();
  const exists = config.cams.some((c) => c.id === id);
  if (!exists) return NextResponse.json({ error: "not found" }, { status: 404 });
  const next = {
    ...config,
    cams: config.cams.filter((c) => c.id !== id),
    // Also remove widgets that reference this cam
    widgets: config.widgets.filter(
      (w) => w.type !== "reolink" || w.camId !== id,
    ),
  };
  await saveConfig(next);
  invalidateToken(id);
  await writeGo2rtcYaml(next);
  await reloadGo2rtc(next.settings.go2rtcUrl);
  await syncWorkers();
  void notifySidecarConfigChanged();
  return NextResponse.json({ ok: true });
}
