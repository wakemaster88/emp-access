import { loadConfig } from "@/lib/config";
import { go2rtcApiUrl, isValidStreamName } from "@/lib/go2rtc";

export const dynamic = "force-dynamic";

/** SDP-Offers sind wenige KB groß — alles darüber ist kein Offer. */
const MAX_OFFER_BYTES = 256 * 1024;

/**
 * WebRTC-Signalisierung fürs Dashboard: reicht das SDP-Offer des Browsers
 * an go2rtc (`/api/webrtc`) weiter und liefert das Answer zurück.
 *
 * Der Browser spricht damit nur noch mit der Next-App (gleiche Origin,
 * gleiche Anmeldung). go2rtc selbst lauscht nur auf Loopback und braucht
 * kein `origin: "*"` — seine API gäbe sonst die Kamera-Passwörter preis.
 * Nur die Signalisierung läuft hier durch; das Video kommt weiter direkt
 * per WebRTC von go2rtc.
 */
export async function POST(req: Request) {
  const src = new URL(req.url).searchParams.get("src") ?? "";
  if (!isValidStreamName(src)) {
    return Response.json({ error: "src ungültig" }, { status: 400 });
  }
  const offer = await req.text();
  if (!offer || offer.length > MAX_OFFER_BYTES) {
    return Response.json({ error: "SDP-Offer fehlt oder zu groß" }, { status: 400 });
  }

  const config = await loadConfig();
  try {
    const r = await fetch(
      go2rtcApiUrl(config.settings.go2rtcUrl, `/api/webrtc?src=${encodeURIComponent(src)}`),
      {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    const answer = await r.text();
    return new Response(answer, {
      status: r.status,
      headers: { "Content-Type": "application/sdp", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return Response.json(
      { error: `go2rtc nicht erreichbar: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
