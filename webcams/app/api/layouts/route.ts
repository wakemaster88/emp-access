import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { LayoutSchema } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await loadConfig();
  return NextResponse.json({
    layouts: config.layouts,
    activeLayoutId: config.activeLayoutId,
  });
}

export async function POST(req: Request) {
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
  const config = await loadConfig();
  if (config.layouts.some((l) => l.id === parsed.data.id)) {
    return NextResponse.json(
      { error: `layout id "${parsed.data.id}" existiert bereits` },
      { status: 409 },
    );
  }
  const next = { ...config, layouts: [...config.layouts, parsed.data] };
  await saveConfig(next);
  return NextResponse.json({ ok: true, layout: parsed.data });
}

export async function PUT(req: Request) {
  // Set activeLayoutId
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { activeLayoutId } = (body ?? {}) as { activeLayoutId?: string | null };
  const config = await loadConfig();
  if (activeLayoutId && !config.layouts.some((l) => l.id === activeLayoutId)) {
    return NextResponse.json({ error: "layout not found" }, { status: 404 });
  }
  const next = { ...config, activeLayoutId: activeLayoutId ?? null };
  await saveConfig(next);
  return NextResponse.json({ ok: true, activeLayoutId: next.activeLayoutId });
}
