import { NextResponse } from "next/server";
import { z } from "zod";
import { getCamOrThrow } from "@/lib/cam-helpers";
import { setSpotlight } from "@/lib/reolink-control";
import { logEvent } from "@/lib/audit";
import { REOLINK_CAPS } from "@/lib/types";

import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Body = z.object({
  on: z.boolean(),
  brightness: z.number().int().min(1).max(100).default(100),
});

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteCtx) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  try {
    const cam = await getCamOrThrow(id);
    if (!REOLINK_CAPS[cam.model].spotlight) {
      return NextResponse.json(
        { error: `${cam.model} hat keinen Spotlight` },
        { status: 400 },
      );
    }
    await setSpotlight(cam, parsed.data.on, parsed.data.brightness);
    await logEvent({
      action: "spotlight",
      target: id,
      ok: true,
      meta: { on: parsed.data.on, brightness: parsed.data.brightness },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = err as Error;
    await logEvent({ action: "spotlight", target: id, ok: false, meta: { error: e.message } });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
