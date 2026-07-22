import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { getDevInfo } from "@/lib/reolink";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const config = await loadConfig();
  const cam = config.cams.find((c) => c.id === id);
  if (!cam) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const info = await getDevInfo(cam, ctl.signal);
    clearTimeout(t);
    return NextResponse.json({ ok: true, info });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 200 },
    );
  }
}
