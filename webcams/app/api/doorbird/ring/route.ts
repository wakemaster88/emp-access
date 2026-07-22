import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { publishRing } from "@/lib/event-bus";
import { logEvent } from "@/lib/audit";
import { scheduleDoorbirdRingSnapshotPipeline } from "@/lib/doorbird-event-followup";

export const dynamic = "force-dynamic";

async function handleRing(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") ?? "";
  const config = await loadConfig();
  const expected = config.doorbird.webhookSecret;

  if (!config.doorbird.enabled) {
    return NextResponse.json({ error: "doorbird disabled" }, { status: 403 });
  }
  if (!expected || secret !== expected) {
    await logEvent({
      action: "doorbird-ring",
      ok: false,
      meta: { reason: "invalid secret", ip: req.headers.get("x-forwarded-for") ?? "?" },
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const accepted = publishRing({ ip: req.headers.get("x-forwarded-for") });
  if (accepted) {
    await logEvent({ action: "doorbird-ring", target: "doorbird", ok: true });
    scheduleDoorbirdRingSnapshotPipeline(req.headers.get("x-forwarded-for"));
  }
  return NextResponse.json({ ok: true, accepted });
}

export async function GET(req: Request) {
  return handleRing(req);
}

export async function POST(req: Request) {
  return handleRing(req);
}
