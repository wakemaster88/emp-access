import { loadConfig } from "@/lib/config";
import { sidecarAuthHeaders } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * Proxy auf den Sidecar — liefert tagesweise Aggregate der letzten N Tage.
 *
 *   GET /api/counters/cam-shop/history?days=14
 *   → { camId, days: [{date, in, out, delta}, ...] }
 *
 * Ist der Sidecar offline, antworten wir mit 503 und leerer Liste, damit
 * UI-Komponenten das defensiv handhaben können (Fallback „noch keine Daten").
 */
export async function GET(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days") ?? "7") || 7));

  const config = await loadConfig();
  const base = config.settings.tracker.url.replace(/\/$/, "");

  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch(
      `${base}/counters/${encodeURIComponent(id)}/history?days=${days}`,
      { signal: ctl.signal, cache: "no-store", headers: await sidecarAuthHeaders() },
    );
    if (!r.ok) {
      const text = await r.text();
      return Response.json(
        { error: `tracker upstream HTTP ${r.status}: ${text}` },
        { status: r.status },
      );
    }
    const json = await r.json();
    return Response.json(json, {
      // 30 s Browser-Cache — Tagesaggregate verändern sich nicht so schnell.
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" },
    });
  } catch (err) {
    return Response.json(
      { error: `tracker offline: ${(err as Error).message}`, camId: id, days: [] },
      { status: 503 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
