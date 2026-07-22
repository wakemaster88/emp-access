import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { LayoutSchema } from "@/lib/types";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function PUT(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = LayoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  if (parsed.data.id !== id) {
    return NextResponse.json({ error: "id mismatch" }, { status: 400 });
  }
  const config = await loadConfig();
  const idx = config.layouts.findIndex((l) => l.id === id);
  if (idx === -1) return NextResponse.json({ error: "not found" }, { status: 404 });
  const next = {
    ...config,
    layouts: config.layouts.map((l, i) => (i === idx ? parsed.data : l)),
  };
  await saveConfig(next);
  return NextResponse.json({ ok: true, layout: parsed.data });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const config = await loadConfig();
  const exists = config.layouts.some((l) => l.id === id);
  if (!exists) return NextResponse.json({ error: "not found" }, { status: 404 });
  const next = {
    ...config,
    layouts: config.layouts.filter((l) => l.id !== id),
    activeLayoutId: config.activeLayoutId === id ? null : config.activeLayoutId,
  };
  await saveConfig(next);
  return NextResponse.json({ ok: true });
}
