import { NextResponse } from "next/server";
import { z } from "zod";
import { getCamOrThrow } from "@/lib/cam-helpers";
import { setIr, type IrState } from "@/lib/reolink-control";
import { logEvent } from "@/lib/audit";

import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Body = z.object({
  state: z.enum(["Auto", "On", "Off"]),
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
    await setIr(cam, parsed.data.state as IrState);
    await logEvent({ action: "ir", target: id, ok: true, meta: { state: parsed.data.state } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = err as Error;
    await logEvent({ action: "ir", target: id, ok: false, meta: { error: e.message } });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
