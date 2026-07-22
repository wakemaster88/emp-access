import { getCamOrThrow } from "@/lib/cam-helpers";
import { getSnapshot } from "@/lib/reolink-control";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  try {
    const cam = await getCamOrThrow(id);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const buf = await getSnapshot(cam, { signal: ctl.signal });
    clearTimeout(t);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(`Snapshot error: ${(err as Error).message}`, { status: 502 });
  }
}
