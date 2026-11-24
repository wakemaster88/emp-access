import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { validateApiToken } from "@/lib/api-auth";
import { ingestSwitchSnapshots, type SwitchIngestPayload } from "@/lib/snmp-ingest";
import { mergeHubAgentStatus } from "@/lib/hub-agent-status";

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

  // `SwitchIngestPayload` hat optionale Felder; `InputJsonValue` verbietet
  // `undefined`. Beim Schreiben wird nach JSON serialisiert und sie fallen
  // weg – der Umweg über `unknown` ist hier die Grenze zwischen beidem.
  const snmp = { at: new Date().toISOString(), switches, stats };

  // Zeile anlegen bzw. lastSeenAt setzen; `status.snmp` danach in einer
  // eigenen Anweisung, die die uebrigen Teile von status unberuehrt laesst.
  await db.hubAgent.upsert({
    where: { accountId_name: { accountId: account.id, name } },
    create: {
      name,
      status: { snmp } as unknown as Prisma.InputJsonValue,
      lastSeenAt: new Date(),
      accountId: account.id,
    },
    update: { lastSeenAt: new Date() },
    select: { id: true },
  });
  await mergeHubAgentStatus(db, account.id, name, { snmp });

  return NextResponse.json({ ok: true, ...stats });
}
