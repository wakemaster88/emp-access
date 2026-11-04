import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { parseHubSample, storeHubSamples, type HubSample } from "@/lib/climate-history";

/**
 * POST (Hub, Token-Auth): 5-Minuten-Fenster der Klimafuehler.
 *
 * Der Hub liest die Fuehler im LAN jede Minute und meldet alle fuenf Minuten
 * die abgeschlossenen Fenster; was er nicht loswird, schickt er spaeter nach
 * (bis zu sieben Tage). Ein Fenster, das die Cloud inzwischen als Notnagel
 * geschrieben hat, wird durch die Hub-Werte ersetzt.
 *
 * Body: { samples: [{ deviceId, bucketStart, tempMin?, tempAvg, tempMax?, humMin?, humAvg, humMax?, count }] }
 */
const MAX_SAMPLES = 2000;

export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const raw: unknown[] = Array.isArray(body.samples) ? body.samples.slice(0, MAX_SAMPLES) : [];
  const now = Date.now();
  const samples = raw.map((s) => parseHubSample(s, now)).filter((s): s is HubSample => !!s);
  const stored = await storeHubSamples(auth.account.id, samples);
  return NextResponse.json({ ok: true, received: raw.length, stored });
}
