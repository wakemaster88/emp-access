import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { doorbirdOpenDoor } from "@/lib/doorbird";
import { getLastRingAt } from "@/lib/event-bus";
import { logEvent } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { evaluateDoorOpen } from "@/lib/door-policy";
import { scheduleDoorbirdOpenSnapshotPipeline } from "@/lib/doorbird-event-followup";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const config = await loadConfig();
  if (!config.doorbird.enabled || !config.doorbird.ip) {
    return NextResponse.json({ error: "doorbird not configured" }, { status: 400 });
  }

  // Optionaler Trigger-Kontext (z.B. vom ALPR-Sidecar). Body ist optional —
  // wenn keiner kommt, ignorieren wir das stillschweigend, damit das UI
  // weiter ohne Body POSTen kann.
  let source = "ui";
  let plate: string | undefined;
  let owner: string | undefined;
  try {
    const body = (await req.json()) as
      | { source?: string; plate?: string; owner?: string }
      | undefined;
    if (body) {
      if (typeof body.source === "string") source = body.source;
      if (typeof body.plate === "string") plate = body.plate;
      if (typeof body.owner === "string") owner = body.owner;
    }
  } catch {
    // kein Body — ok
  }

  // Ring-Fenster wird serverseitig erzwungen (konfigurierbar über
  // `doorbird.enforceRingWindow`). ALPR- und Ausfahrt-Auto-Open sind
  // ausgenommen — deren Schutz sitzt im Sidecar (Whitelist bzw. Zone + Cooldown).
  const decision = evaluateDoorOpen({
    enforceRingWindow: config.doorbird.enforceRingWindow,
    source,
    lastRingAt: getLastRingAt(),
    now: Date.now(),
    ringWindowSec: config.doorbird.ringWindowSec,
  });
  const { inWindow, elapsedMs: elapsed } = decision;

  if (!decision.allowed) {
    await logEvent({
      action: "doorbird-open",
      ok: false,
      meta: { source, plate, owner, reason: decision.reason, elapsedSinceRingMs: elapsed },
    });
    return NextResponse.json({ error: decision.reason }, { status: 403 });
  }

  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    await doorbirdOpenDoor(config.doorbird, ctl.signal);
    clearTimeout(t);
    await logEvent({
      action: "doorbird-open",
      ok: true,
      meta: {
        source,
        plate,
        owner,
        relay: config.doorbird.relayId,
        inRingWindow: inWindow,
        elapsedSinceRingMs: elapsed,
      },
    });
    scheduleDoorbirdOpenSnapshotPipeline({
      source,
      plate,
      owner,
      inRingWindow: inWindow,
      elapsedSinceRingMs: elapsed,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = err as Error;
    await logEvent({
      action: "doorbird-open",
      ok: false,
      meta: { source, plate, owner, error: e.message },
    });
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
