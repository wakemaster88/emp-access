import { alprFetch } from "@/lib/alpr-client";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const r = await alprFetch("/alpr/test", { method: "POST" });
    const json = await r.json().catch(() => ({}));
    return Response.json(json, { status: r.status });
  } catch (err) {
    return Response.json(
      { error: `tracker offline: ${(err as Error).message}` },
      { status: 503 },
    );
  }
}
