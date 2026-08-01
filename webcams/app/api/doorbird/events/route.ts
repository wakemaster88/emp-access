import { busEventStream } from "@/lib/sse";

export const dynamic = "force-dynamic";

/** Bestandspfad für den Klingel-Listener; der Strom selbst ist allgemein. */
export async function GET() {
  return busEventStream();
}
