import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { Prisma } from "@prisma/client";

function statusObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

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

  const existing = await db.hubAgent.findUnique({
    where: { accountId_name: { accountId: account.id, name } },
    select: { status: true },
  });
  const status = {
    ...statusObject(existing?.status),
    parking,
  } as Prisma.InputJsonValue;

  const agent = await db.hubAgent.upsert({
    where: { accountId_name: { accountId: account.id, name } },
    create: {
      name,
      lastSeenAt: new Date(),
      status,
      accountId: account.id,
    },
    update: {
      lastSeenAt: new Date(),
      status,
    },
  });

  return NextResponse.json({ ok: true, agentId: agent.id });
}
