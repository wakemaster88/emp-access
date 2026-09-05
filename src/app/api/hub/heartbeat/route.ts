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
 * Heartbeat des lokalen Hubs. Auth per Account-API-Token (Bearer/`?token=`).
 * Upsert per (accountId, name); liefert die Anzahl offener Tasks zurueck,
 * damit der Hub sein Poll-Intervall dynamisch verkuerzen kann.
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "hub";
  const parking =
    body.parking && typeof body.parking === "object" && !Array.isArray(body.parking)
      ? body.parking
      : undefined;

  // Systemzustand des Hub-Macs (Auto-Login, Ruhezustand, Einschaltplan).
  const system =
    body.system && typeof body.system === "object" && !Array.isArray(body.system)
      ? body.system
      : undefined;

  const existing = await db.hubAgent.findUnique({
    where: { accountId_name: { accountId: account.id, name } },
    select: { status: true },
  });
  const status =
    parking || system
      ? ({
          ...statusObject(existing?.status),
          ...(parking ? { parking } : {}),
          ...(system ? { system } : {}),
        } as Prisma.InputJsonValue)
      : undefined;

  const agent = await db.hubAgent.upsert({
    where: { accountId_name: { accountId: account.id, name } },
    create: {
      name,
      hostname: body.hostname || null,
      version: body.version || null,
      modules: body.modules ?? undefined,
      ...(status ? { status } : {}),
      lastSeenAt: new Date(),
      accountId: account.id,
    },
    update: {
      hostname: body.hostname || null,
      version: body.version || null,
      modules: body.modules ?? undefined,
      ...(status ? { status } : {}),
      lastSeenAt: new Date(),
    },
  });

  const pendingTasks = await db.hubTask.count({
    where: { accountId: account.id, status: "PENDING" },
  });

  return NextResponse.json({ ok: true, agentId: agent.id, pendingTasks });
}
