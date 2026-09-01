import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateApiToken } from "@/lib/api-auth";
import { ingestSwitchSnapshots, type SwitchIngestPayload } from "@/lib/snmp-ingest";

function statusObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/**
 * POST (Hub): SNMP-Snapshot der Switches. Aktualisiert NetworkDevice/Ports
 * und legt den Rohstand in HubAgent.status.snmp ab.
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const body = await request.json().catch(() => ({}));
  const name =
    typeof body.hubName === "string" && body.hubName.trim()
      ? body.hubName.trim()
      : "hub";
  const switches = (Array.isArray(body.switches) ? body.switches : []) as SwitchIngestPayload[];

  const stats = await ingestSwitchSnapshots(db, account.id, switches);

  const existing = await db.hubAgent.findUnique({
    where: { accountId_name: { accountId: account.id, name } },
    select: { status: true },
  });
  // `SwitchIngestPayload` hat optionale Felder; `InputJsonValue` verbietet
  // `undefined`. Beim Schreiben serialisiert Prisma nach JSON und laesst sie
  // fallen – der Umweg über `unknown` ist hier die Grenze zwischen beidem.
  const status = {
    ...statusObject(existing?.status),
    snmp: { at: new Date().toISOString(), switches, stats },
  } as unknown as Prisma.InputJsonValue;

  await db.hubAgent.upsert({
    where: { accountId_name: { accountId: account.id, name } },
    create: {
      name,
      status,
      lastSeenAt: new Date(),
      accountId: account.id,
    },
    update: { status, lastSeenAt: new Date() },
  });

  return NextResponse.json({ ok: true, ...stats });
}
