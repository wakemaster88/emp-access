import { loadConfig } from "@/lib/config";
import { sidecarAuthHeaders } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * Proxy: Parkplatz-Auswertung (Tagesaggregate + heutige Stunden).
 */
export async function GET(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days") ?? "14") || 14));

  const config = await loadConfig();
  const base = config.settings.tracker.url.replace(/\/$/, "");

  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch(
      `${base}/counters/${encodeURIComponent(id)}/parking?days=${days}`,
      { signal: ctl.signal, cache: "no-store", headers: await sidecarAuthHeaders() },
    );
    if (!r.ok) {
      const text = await r.text();
      return Response.json(
        { error: `tracker upstream HTTP ${r.status}: ${text}` },
        { status: r.status },
      );
    }
    return Response.json(await r.json(), {
      headers: { "Cache-Control": "public, max-age=20, stale-while-revalidate=40" },
    });
  } catch (err) {
    return Response.json(
      { error: `tracker offline: ${(err as Error).message}`, camId: id, days: [], hours: [] },
      { status: 503 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
