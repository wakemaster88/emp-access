import { NextResponse } from "next/server";
import { z } from "zod";
import { getCamOrThrow } from "@/lib/cam-helpers";
import { ptzCtrl, type PtzOp } from "@/lib/reolink-control";
import { logEvent } from "@/lib/audit";
import { REOLINK_CAPS } from "@/lib/types";
import { notifyManualPtz } from "@/lib/ptz-auto-client";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PTZ_OPS = [
  "Left",
  "Right",
  "Up",
  "Down",
  "LeftUp",
  "LeftDown",
  "RightUp",
  "RightDown",
  "ZoomInc",
  "ZoomDec",
  "FocusInc",
  "FocusDec",
  "Stop",
] as const;

const Body = z.object({
  op: z.enum(PTZ_OPS),
  speed: z.number().int().min(1).max(64).default(32),
  /**
   * Marker, dass der Aufruf vom Auto-Pilot kommt und kein Manual-Override
   * triggern soll. UI-Aufrufe lassen das Feld einfach weg.
   */
  _source: z.string().optional(),
});

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteCtx) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const cam = await getCamOrThrow(id);
    const caps = REOLINK_CAPS[cam.model];
    const op = parsed.data.op;
    if (!caps.ptz && (op === "Left" || op === "Right" || op === "Up" || op === "Down" || op.startsWith("Left") || op.startsWith("Right"))) {
      return NextResponse.json({ error: `${cam.model} unterstützt keine PTZ` }, { status: 400 });
    }
    if (caps.zoom !== "optical" && (op === "ZoomInc" || op === "ZoomDec")) {
      return NextResponse.json(
        { error: `${cam.model} hat keinen optischen Zoom` },
        { status: 400 },
      );
    }
    await ptzCtrl(cam, op as PtzOp, { speed: parsed.data.speed });
    // User-Eingriff → Auto-Pilot 90s pausieren. Sidecar-eigene Aufrufe
    // (`_source: "ptz-auto"`) lösen den Override absichtlich nicht aus.
    if (parsed.data._source !== "ptz-auto") {
      void notifyManualPtz(id);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = err as Error;
    await logEvent({ action: "ptz", target: id, ok: false, meta: { error: e.message, op: parsed.data.op } });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
