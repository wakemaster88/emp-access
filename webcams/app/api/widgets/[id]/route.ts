import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { WidgetSchema } from "@/lib/types";

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
  const parsed = WidgetSchema.safeParse(body);
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
  const idx = config.widgets.findIndex((w) => w.id === id);
  if (idx === -1) return NextResponse.json({ error: "not found" }, { status: 404 });
  const next = {
    ...config,
    widgets: config.widgets.map((w, i) => (i === idx ? parsed.data : w)),
  };
  await saveConfig(next);
  return NextResponse.json({ ok: true, widget: parsed.data });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const config = await loadConfig();
  const exists = config.widgets.some((w) => w.id === id);
  if (!exists) return NextResponse.json({ error: "not found" }, { status: 404 });
  const next = {
    ...config,
    widgets: config.widgets.filter((w) => w.id !== id),
    layouts: config.layouts.map((l) => {
      const { [id]: _, ...rest } = l.positions;
      return {
        ...l,
        positions: rest,
        focusWidgetId: l.focusWidgetId === id ? null : l.focusWidgetId,
      };
    }),
  };
  await saveConfig(next);
  return NextResponse.json({ ok: true });
}
