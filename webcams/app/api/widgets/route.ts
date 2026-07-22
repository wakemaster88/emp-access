import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { WidgetSchema } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await loadConfig();
  return NextResponse.json(config.widgets);
}

export async function POST(req: Request) {
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
  const config = await loadConfig();
  if (config.widgets.some((w) => w.id === parsed.data.id)) {
    return NextResponse.json(
      { error: `widget id "${parsed.data.id}" existiert bereits` },
      { status: 409 },
    );
  }
  const next = { ...config, widgets: [...config.widgets, parsed.data] };
  await saveConfig(next);
  return NextResponse.json({ ok: true, widget: parsed.data });
}
