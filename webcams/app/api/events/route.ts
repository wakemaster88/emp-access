import { busEventStream } from "@/lib/sse";
import { ensureTailgateLiveStarted } from "@/lib/tailgate-live";

export const dynamic = "force-dynamic";

/**
 * Allgemeiner Ereignisstrom fürs Dashboard.
 *
 * Zieht die Sofortprüfung am Drehkreuz hoch, falls sie noch nicht läuft —
 * so wie die anderen Hintergrundaufgaben auch, damit ein offenes Dashboard
 * allein schon genügt.
 */
export async function GET() {
  ensureTailgateLiveStarted();
  return busEventStream();
}
