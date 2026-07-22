import { loadConfig } from "@/lib/config";
import { sidecarAuthHeaders } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * Proxy auf das Debug-Bild des Tracker-Sidecars.
 *
 * Der Sidecar lauscht auf 127.0.0.1:8088 und ist nicht von außen
 * erreichbar; der Browser kann das Bild deshalb nur über die Next-App
 * abholen.
 */
export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const config = await loadConfig();
  const base = config.settings.tracker.url.replace(/\/$/, "");
  const url = `${base}/debug/${encodeURIComponent(id)}/snapshot.jpg`;

  try {
    const r = await fetch(url, { cache: "no-store", headers: await sidecarAuthHeaders() });
    if (!r.ok) {
      return new Response(`tracker upstream HTTP ${r.status}`, {
        status: r.status,
      });
    }
    const buf = await r.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(`tracker offline: ${(err as Error).message}`, {
      status: 503,
    });
  }
}
