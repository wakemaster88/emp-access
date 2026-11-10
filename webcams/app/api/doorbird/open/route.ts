import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { doorbirdOpenDoor } from "@/lib/doorbird";
import { getLastRingAt } from "@/lib/event-bus";
import { logEvent } from "@/lib/audit";
import { isInternalRequest, requireAuth } from "@/lib/auth";
import { evaluateDoorOpen, resolveDoorSource } from "@/lib/door-policy";
import { requireSameOrigin } from "@/lib/same-origin";
import { scheduleDoorbirdOpenSnapshotPipeline } from "@/lib/doorbird-event-followup";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const crossOrigin = requireSameOrigin(req);
  if (crossOrigin) return crossOrigin;
  const denied = await requireAuth(req);
  if (denied) return denied;

  const config = await loadConfig();
  if (!config.doorbird.enabled || !config.doorbird.ip) {
    return NextResponse.json({ error: "doorbird not configured" }, { status: 400 });
  }

  // Optionaler Trigger-Kontext (z.B. vom ALPR-Sidecar). Body ist optional —
  // wenn keiner kommt, ignorieren wir das stillschweigend, damit das UI
  // weiter ohne Body POSTen kann.
  let requestedSource: string | undefined;
  let plate: string | undefined;
  let owner: string | undefined;
  try {
    const body = (await req.json()) as
      | { source?: string; plate?: string; owner?: string }
      | undefined;
    if (body) {
      if (typeof body.source === "string") requestedSource = body.source;
      if (typeof body.plate === "string") plate = body.plate;
      if (typeof body.owner === "string") owner = body.owner;
    }
  } catch {
    // kein Body — ok
  }

  // `source` (und Kennzeichen/Halter fürs Audit-Log) zählen nur, wenn der
  // Aufrufer das interne Token vorlegt (Tracker-Sidecar). Sonst ist es ein
  // normaler UI-Aufruf — ein Browser kann sich nicht als "alpr" ausgeben.
  const internal = await isInternalRequest(req);
  const source = resolveDoorSource(requestedSource, internal);
  // Fürs Audit-Log festhalten, wenn jemand ohne Token eine Quelle behauptet.
  const claimedSource =
    !internal && requestedSource && requestedSource !== source
      ? requestedSource
      : undefined;
  if (!internal) {
    plate = undefined;
    owner = undefined;
  }

  // Ring-Fenster wird serverseitig erzwungen (konfigurierbar über
  // `doorbird.enforceRingWindow`). ALPR- und Ausfahrt-Auto-Open sind
  // ausgenommen — deren Schutz sitzt im Sidecar (Whitelist bzw. Zone + Cooldown).
  // Die Ausnahme gilt nur für intern authentifizierte Aufrufe.
  const decision = evaluateDoorOpen({
    enforceRingWindow: config.doorbird.enforceRingWindow,
    source,
    internal,
    lastRingAt: getLastRingAt(),
    now: Date.now(),
    ringWindowSec: config.doorbird.ringWindowSec,
  });
  const { inWindow, elapsedMs: elapsed } = decision;

  if (!decision.allowed) {
    await logEvent({
      action: "doorbird-open",
      ok: false,
      meta: {
        source,
        claimedSource,
        plate,
        owner,
        reason: decision.reason,
        elapsedSinceRingMs: elapsed,
      },
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
