import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { ensureTailgateStarted, getTailgateSnapshot } from "@/lib/tailgate";

export const dynamic = "force-dynamic";

/** Stand der Drehkreuz-Kontrolle für Kachel und Admin-Ansicht. */
export async function GET() {
  ensureTailgateStarted();
  const cfg = await loadConfig();
  const { status, alarms } = getTailgateSnapshot();
  const names = new Map(cfg.cams.map((c) => [c.id, c.name]));
  return NextResponse.json({
    configured: cfg.cams.some((c) => c.enabled && c.tailgate.enabled),
    status: status.map((s) => ({ ...s, camName: names.get(s.camId) ?? s.camId })),
    alarms,
  });
}
