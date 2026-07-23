import { alprFetch } from "@/lib/alpr-client";

export const dynamic = "force-dynamic";

/** Proxy zum Sidecar: annotierter Snapshot eines Edge-Events. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const r = await alprFetch(`/edge/snapshot/${encodeURIComponent(id)}.jpg`);
    if (!r.ok) {
      return new Response("snapshot not found", { status: 404 });
    }
    return new Response(await r.arrayBuffer(), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=600",
      },
    });
  } catch {
    return new Response("sidecar unreachable", { status: 502 });
  }
}
