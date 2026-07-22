import { NextResponse } from "next/server";
import { ensureWorkersStarted, getAllCounters } from "@/lib/people-counter";
import { fetchCrossingCounters } from "@/lib/people-tracker";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureWorkersStarted();

  // Beide Quellen parallel — Sidecar darf wegfallen, ohne den Endpoint zu brechen.
  const [presenceRaw, crossing] = await Promise.all([
    Promise.resolve(getAllCounters()),
    fetchCrossingCounters(),
  ]);

  const counters: Record<string, unknown> = {};
  for (const [camId, c] of Object.entries(presenceRaw)) {
    counters[camId] = { mode: "presence" as const, ...c };
  }
  // Crossing überschreibt presence pro Cam (sollte sich ohnehin ausschließen,
  // aber eindeutige Quelle der Wahrheit pro Cam bleibt der Tracker, falls beides
  // versehentlich liefert).
  for (const [camId, c] of Object.entries(crossing)) {
    counters[camId] = c;
  }

  return NextResponse.json({ counters });
}
