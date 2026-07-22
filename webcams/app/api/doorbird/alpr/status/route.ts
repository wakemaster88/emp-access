import { alprFetch } from "@/lib/alpr-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const r = await alprFetch("/alpr/status");
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
