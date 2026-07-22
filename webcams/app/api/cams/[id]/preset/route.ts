import { NextResponse } from "next/server";
import { z } from "zod";
import { getCamOrThrow } from "@/lib/cam-helpers";
import { ptzCtrl, getPtzPresets } from "@/lib/reolink-control";
import { logEvent } from "@/lib/audit";
import { REOLINK_CAPS } from "@/lib/types";
import { notifyManualPtz } from "@/lib/ptz-auto-client";

import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Body = z.object({
  op: z.enum(["ToPos", "SetPos"]),
  presetId: z.number().int().min(0).max(63),
  /** Siehe /ptz: "ptz-auto" markiert Sidecar-Aufrufe, sonst pausiert sich der Auto-Pilot selbst. */
  _source: z.string().optional(),
});

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  try {
    const cam = await getCamOrThrow(id);
    if (!REOLINK_CAPS[cam.model].ptz) {
      return NextResponse.json({ presets: [] });
    }
    const result = (await getPtzPresets(cam)) as
      | { PtzPreset?: { id: number; name: string }[] }
      | undefined;
    return NextResponse.json({ presets: result?.PtzPreset ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, presets: [] },
      { status: 200 },
    );
  }
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
    if (!REOLINK_CAPS[cam.model].ptz) {
      return NextResponse.json(
        { error: `${cam.model} hat keine PTZ-Funktion` },
        { status: 400 },
      );
    }
    await ptzCtrl(cam, parsed.data.op, { presetId: parsed.data.presetId });
    await logEvent({
      action: parsed.data.op === "ToPos" ? "preset-go" : "preset-save",
      target: id,
      ok: true,
      meta: { presetId: parsed.data.presetId },
    });
    // User-Aufrufe pausieren den Auto-Pilot, damit er nicht zurück-überschreibt.
    if (parsed.data._source !== "ptz-auto") {
      void notifyManualPtz(id);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = err as Error;
    await logEvent({
      action: parsed.data.op === "ToPos" ? "preset-go" : "preset-save",
      target: id,
      ok: false,
      meta: { error: e.message, presetId: parsed.data.presetId },
    });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
