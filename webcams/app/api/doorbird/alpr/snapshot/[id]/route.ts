import { alprFetch } from "@/lib/alpr-client";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  try {
    const r = await alprFetch(`/alpr/snapshot/${encodeURIComponent(id)}.jpg`);
    if (!r.ok) {
      return new Response(`tracker HTTP ${r.status}`, { status: r.status });
    }
    const buf = await r.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=600",
      },
    });
  } catch (err) {
    return new Response(`tracker offline: ${(err as Error).message}`, {
      status: 503,
    });
  }
}
