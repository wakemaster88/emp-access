import { fetchPtzAutoStatus } from "@/lib/ptz-auto-client";

export const dynamic = "force-dynamic";

/**
 * Gibt den aktuellen Status aller PTZ-Auto-Worker zurück (Map cam-id → Status).
 *
 * Der Sidecar liefert pro Cam: Modus, Sub-Status (patrol/follow/idle/paused/homing),
 * letzte Aktion, FPS, manueller-Override-Restzeit, etc.
 */
export async function GET() {
  const status = await fetchPtzAutoStatus();
  return Response.json({ ptz: status });
}
