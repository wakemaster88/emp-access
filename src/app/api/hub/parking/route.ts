import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-token-auth";
import { writeHubAgentStatus } from "@/lib/hub-agent-status";

/**
 * POST (Hub): Parkplatz-Belegung aus Kiosk-Tracker (vehicleGate-Zonen).
 * Häufiger als der Heartbeat, damit /fahrzeuge live bleibt.
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "hub";
  const parking = body.parking;
  if (!parking || typeof parking !== "object" || Array.isArray(parking)) {
    return NextResponse.json({ error: "parking fehlt" }, { status: 400 });
  }

  // Zeile anlegen bzw. lastSeenAt und `status.parking` setzen, in einer
  // Anweisung; die uebrigen Teile von status bleiben unberuehrt.
  const agentId = await writeHubAgentStatus(db, account.id, name, { parking });

  return NextResponse.json({ ok: true, agentId });
}
