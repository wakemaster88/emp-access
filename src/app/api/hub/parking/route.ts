import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { Prisma } from "@prisma/client";
import { mergeHubAgentStatus } from "@/lib/hub-agent-status";

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

  // Zeile anlegen bzw. lastSeenAt setzen; `status.parking` danach in einer
  // eigenen Anweisung, die die uebrigen Teile von status unberuehrt laesst.
  const agent = await db.hubAgent.upsert({
    where: { accountId_name: { accountId: account.id, name } },
    create: {
      name,
      lastSeenAt: new Date(),
      status: { parking } as Prisma.InputJsonValue,
      accountId: account.id,
    },
    update: {
      lastSeenAt: new Date(),
    },
    select: { id: true },
  });
  await mergeHubAgentStatus(db, account.id, name, { parking });

  return NextResponse.json({ ok: true, agentId: agent.id });
}
