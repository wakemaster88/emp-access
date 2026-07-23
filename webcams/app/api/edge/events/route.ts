import { alprFetch } from "@/lib/alpr-client";

export const dynamic = "force-dynamic";

/**
 * Proxy zum Sidecar: filterbare Edge-Event-Historie.
 * Query-Parameter werden 1:1 durchgereicht (cam_id, rule_type, from_ms,
 * to_ms, limit, offset).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  try {
    const r = await alprFetch(`/edge/events${qs ? `?${qs}` : ""}`);
    if (!r.ok) {
      return Response.json(
        { events: [], total: 0, error: `sidecar HTTP ${r.status}` },
        { status: 502 },
      );
    }
    return Response.json(await r.json());
  } catch (e) {
    return Response.json(
      { events: [], total: 0, error: (e as Error).message },
      { status: 502 },
    );
  }
}
