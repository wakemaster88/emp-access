import { loadConfig } from "@/lib/config";
import { sidecarAuthHeaders } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * Setzt in/out-Zähler einer Cam beim Tracker-Sidecar auf 0.
 * Reine Pass-Through, weil der Sidecar lokal-only erreichbar ist.
 */
export async function POST(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const config = await loadConfig();
  const base = config.settings.tracker.url.replace(/\/$/, "");
  const url = `${base}/counters/${encodeURIComponent(id)}/reset`;
  try {
    const r = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: await sidecarAuthHeaders(),
    });
    if (!r.ok) {
      const text = await r.text();
      return Response.json(
        { error: `tracker upstream HTTP ${r.status}: ${text}` },
        { status: r.status },
      );
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: `tracker offline: ${(err as Error).message}` },
      { status: 503 },
    );
  }
}
