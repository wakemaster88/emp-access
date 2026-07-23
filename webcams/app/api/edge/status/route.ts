import { alprFetch } from "@/lib/alpr-client";

export const dynamic = "force-dynamic";

/**
 * Proxy zum Sidecar: Status aller Edge-Watch-Worker (Map cam-id → Status).
 * Liefert `{ edge: {} }` wenn der Sidecar nicht erreichbar ist — das UI
 * zeigt dann "Sidecar offline" statt eines Fehlers.
 */
export async function GET() {
  try {
    const r = await alprFetch("/edge/status");
    if (!r.ok) return Response.json({ edge: {} });
    return Response.json(await r.json());
  } catch {
    return Response.json({ edge: {} });
  }
}
