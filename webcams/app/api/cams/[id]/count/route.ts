import { NextResponse } from "next/server";
import { getCamOrThrow } from "@/lib/cam-helpers";
import {
  ensureWorkersStarted,
  getCounter,
  triggerNow,
} from "@/lib/people-counter";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  await ensureWorkersStarted();
  const cam = await getCamOrThrow(id);
  if (!cam.peopleCounter.enabled) {
    return NextResponse.json({ enabled: false });
  }
  const entry = getCounter(id);
  return NextResponse.json({
    enabled: true,
    intervalSec: cam.peopleCounter.intervalSec,
    counter: entry,
  });
}

export async function POST(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const cam = await getCamOrThrow(id);
  if (!cam.peopleCounter.enabled) {
    return NextResponse.json(
      { error: "people counter nicht aktiviert" },
      { status: 400 },
    );
  }
  await ensureWorkersStarted();
  try {
    const entry = await triggerNow(id);
    return NextResponse.json({ ok: true, counter: entry });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
