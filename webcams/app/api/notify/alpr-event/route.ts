import { NextResponse } from "next/server";
import { alprFetch } from "@/lib/alpr-client";
import { notify } from "@/lib/notify";
import { logEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Endpoint für den Sidecar — wird nach jedem persistierten ALPR-Event
 * aufgerufen. Wir holen optional den Snapshot vom Sidecar, damit Telegram
 * das Foto verschicken kann.
 *
 * Body (vom Sidecar):
 *   {
 *     kind: "matched" | "unauthorized" | "cooldown",
 *     plate: string,
 *     plateNorm: string,
 *     owner?: string | null,
 *     confidence: number,
 *     snapshotId: string,
 *     doorOpened: boolean,
 *     matched: boolean,
 *     cooldown: boolean
 *   }
 *
 * Wir loggen nichts ins Audit-Log — die Events sind bereits im
 * persistenten ALPR-events.jsonl. Hier geht's nur ums Pushen.
 */

interface AlprEventBody {
  kind: "matched" | "unauthorized" | "cooldown";
  plate: string;
  plateNorm?: string;
  owner?: string | null;
  confidence: number;
  snapshotId?: string;
  doorOpened?: boolean;
  matched?: boolean;
  cooldown?: boolean;
}

async function fetchAlprSnapshot(snapshotId: string): Promise<Buffer | null> {
  try {
    const r = await alprFetch(`/alpr/snapshot/${encodeURIComponent(snapshotId)}.jpg`);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: AlprEventBody;
  try {
    body = (await req.json()) as AlprEventBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body || typeof body.plate !== "string") {
    return NextResponse.json({ error: "missing plate" }, { status: 400 });
  }

  // Snapshot nur ziehen, wenn wir ihn brauchen — bei Telegram disabled spart das
  // einen IO-Roundtrip pro Event.
  const snapshot = body.snapshotId
    ? await fetchAlprSnapshot(body.snapshotId)
    : null;

  const data = {
    plate: body.plate,
    owner: body.owner ?? undefined,
    confidence: typeof body.confidence === "number" ? body.confidence : 0,
    snapshot,
  };

  const kind = body.kind;
  if (kind === "matched") {
    void notify({ type: "alpr-matched", data });
  } else if (kind === "cooldown") {
    void notify({ type: "alpr-cooldown", data });
  } else {
    void notify({ type: "alpr-unauthorized", data });
  }

  // Best-effort Debug-Log (zählt nicht als Audit-Event, daher nur bei Fehlern)
  if (!snapshot && body.snapshotId) {
    await logEvent({
      action: "notify-alpr-event",
      ok: false,
      meta: {
        kind,
        plate: body.plate,
        snapshotId: body.snapshotId,
        reason: "snapshot fetch failed",
      },
    });
  }

  return NextResponse.json({ ok: true, dispatched: kind });
}
