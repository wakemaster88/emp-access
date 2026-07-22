import { NextResponse } from "next/server";
import { z } from "zod";
import { getCamOrThrow } from "@/lib/cam-helpers";
import { setAudioAlarm } from "@/lib/reolink-control";
import { loadConfig } from "@/lib/config";
import { logEvent } from "@/lib/audit";
import { REOLINK_CAPS } from "@/lib/types";
import { getRemainingMs, trigger as triggerCooldown } from "@/lib/cooldown";

import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Body = z.object({
  durationSec: z.number().int().min(1).max(60),
  confirmed: z.literal(true),
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
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const config = await loadConfig();
  const cooldownMs = config.settings.sirenCooldownSec * 1000;
  const maxDuration = config.settings.sirenMaxDurationSec;

  if (parsed.data.durationSec > maxDuration) {
    return NextResponse.json(
      { error: `Maximale Dauer ${maxDuration} s` },
      { status: 400 },
    );
  }

  try {
    const cam = await getCamOrThrow(id);
    if (!REOLINK_CAPS[cam.model].siren) {
      return NextResponse.json(
        { error: `${cam.model} hat keine Sirene` },
        { status: 400 },
      );
    }
    const remaining = getRemainingMs(`siren:${id}`, cooldownMs);
    if (remaining > 0) {
      return NextResponse.json(
        { error: `Cooldown – noch ${Math.ceil(remaining / 1000)} s warten` },
        { status: 429 },
      );
    }
    triggerCooldown(`siren:${id}`);
    await setAudioAlarm(cam, true);
    await logEvent({
      action: "siren-start",
      target: id,
      ok: true,
      meta: { durationSec: parsed.data.durationSec, camName: cam.name },
    });

    // Auto-stop nach Dauer.
    setTimeout(async () => {
      try {
        await setAudioAlarm(cam, false);
        await logEvent({ action: "siren-stop", target: id, ok: true, meta: { reason: "auto" } });
      } catch (e) {
        await logEvent({
          action: "siren-stop",
          target: id,
          ok: false,
          meta: { reason: "auto", error: (e as Error).message },
        });
      }
    }, parsed.data.durationSec * 1000);

    return NextResponse.json({ ok: true, durationSec: parsed.data.durationSec });
  } catch (err) {
    const e = err as Error;
    await logEvent({ action: "siren-start", target: id, ok: false, meta: { error: e.message } });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  try {
    const cam = await getCamOrThrow(id);
    if (!REOLINK_CAPS[cam.model].siren) {
      return NextResponse.json({ error: "no siren" }, { status: 400 });
    }
    await setAudioAlarm(cam, false);
    await logEvent({ action: "siren-stop", target: id, ok: true, meta: { reason: "manual" } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
