import { loadConfig } from "@/lib/config";
import { go2rtcApiUrl, isValidStreamName } from "@/lib/go2rtc";

export const dynamic = "force-dynamic";

/**
 * Standbild eines go2rtc-Streams (`/api/frame.jpeg`) fürs Dashboard —
 * z. B. Akku-Cams, die im Grid nur als Snapshot laufen. Wie die
 * Signalisierung (`../webrtc`) über die Next-App, damit der Browser nicht
 * direkt (cross-origin) mit go2rtc sprechen muss.
 */
export async function GET(req: Request) {
  const src = new URL(req.url).searchParams.get("src") ?? "";
  if (!isValidStreamName(src)) {
    return Response.json({ error: "src ungültig" }, { status: 400 });
  }

  const config = await loadConfig();
  try {
    const r = await fetch(
      go2rtcApiUrl(config.settings.go2rtcUrl, `/api/frame.jpeg?src=${encodeURIComponent(src)}`),
      // go2rtc braucht für das Bild eines ruhenden Streams 1–5 s.
      { cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok) {
      return Response.json({ error: `go2rtc HTTP ${r.status}` }, { status: 502 });
    }
    return new Response(await r.arrayBuffer(), {
      headers: {
        "Content-Type": r.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return Response.json(
      { error: `go2rtc nicht erreichbar: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
