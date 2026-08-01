import { loadConfig } from "@/lib/config";
import { fetchCrossingSnapshot } from "@/lib/people-tracker";

export const dynamic = "force-dynamic";

/**
 * Reicht das Bild eines Durchgangs vom Sidecar an den Browser durch.
 *
 * Der Sidecar hört nur auf 127.0.0.1 und verlangt einen eigenen Schlüssel —
 * der Browser kommt also nicht direkt an die Bilder.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const camId = url.searchParams.get("camId") ?? "";
  const ts = Number(url.searchParams.get("ts"));
  // Ohne `src` das Bild der Zählkamera, sonst der zweite Blickwinkel.
  const src = url.searchParams.get("src") ?? "";
  if (!camId || !Number.isFinite(ts) || ts <= 0) {
    return new Response("camId und ts erforderlich", { status: 400 });
  }

  const cfg = await loadConfig();
  const known = (id: string) => cfg.cams.some((c) => c.id === id);
  if (!known(camId) || (src && !known(src))) {
    return new Response("unbekannte Kamera", { status: 404 });
  }

  const jpeg = await fetchCrossingSnapshot(camId, Math.round(ts), src || undefined);
  if (!jpeg) return new Response("kein Bild", { status: 404 });

  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      // Der Zeitstempel ist eindeutig, das Bild ändert sich nie mehr.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
