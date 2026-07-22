import { alprFetch } from "@/lib/alpr-client";

export const dynamic = "force-dynamic";

/**
 * Proxy für die persistente ALPR-Historie aus dem Python-Sidecar.
 *
 * Query-Params (alle optional, werden 1:1 weitergereicht):
 *   from_ms       – Epoch-MS, untere Grenze
 *   to_ms         – Epoch-MS, obere Grenze
 *   plate         – Substring auf normalisiertem Plate
 *   status        – "opened" | "matched" | "unauthorized"
 *   limit         – Default 50, max 500
 *   offset        – Pagination-Offset
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = new URLSearchParams();
  for (const key of ["from_ms", "to_ms", "plate", "status", "limit", "offset"]) {
    const v = url.searchParams.get(key);
    if (v != null && v !== "") params.set(key, v);
  }
  try {
    const r = await alprFetch(`/alpr/history?${params.toString()}`);
    if (!r.ok) {
      return Response.json(
        { error: `tracker HTTP ${r.status}` },
        { status: r.status },
      );
    }
    return Response.json(await r.json());
  } catch (err) {
    return Response.json(
      { error: `tracker offline: ${(err as Error).message}` },
      { status: 503 },
    );
  }
}
