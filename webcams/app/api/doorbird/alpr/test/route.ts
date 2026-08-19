import { alprFetch } from "@/lib/alpr-client";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    let camId = "";
    try {
      const body = (await req.json()) as { camId?: string } | undefined;
      if (body?.camId) camId = String(body.camId);
    } catch {
      // kein Body — Doorbird-Test wie bisher
    }
    const path = camId
      ? `/alpr/test?cam_id=${encodeURIComponent(camId)}`
      : "/alpr/test";
    const r = await alprFetch(path, { method: "POST" });
    const json = await r.json().catch(() => ({}));
    return Response.json(json, { status: r.status });
  } catch (err) {
    return Response.json(
      { error: `tracker offline: ${(err as Error).message}` },
      { status: 503 },
    );
  }
}
