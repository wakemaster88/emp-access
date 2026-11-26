import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-token-auth";
import { ingestSwitchSnapshots, type SwitchIngestPayload } from "@/lib/snmp-ingest";
import { writeHubAgentStatus } from "@/lib/hub-agent-status";
import { snmpStatusSummary } from "@/lib/hub-status";

/**
 * POST (Hub): SNMP-Snapshot der Switches. Aktualisiert NetworkDevice/Ports
 * (`ingestSwitchSnapshots`) und legt in HubAgent.status.snmp eine
 * Kurzfassung ab: Zeitpunkt, Zahlen des Abgleichs und je Switch Name,
 * Abfragezeit, Anzahl Ports, verbundene Ports, MAC-Eintraege und Fehler.
 * Ports und MAC-Tabellen stehen nur in den Netzwerk-Tabellen.
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

  const snmp = { at: new Date().toISOString(), stats, switches: snmpStatusSummary(switches) };

  // Zeile anlegen bzw. lastSeenAt und `status.snmp` setzen, in einer
  // Anweisung; die uebrigen Teile von status bleiben unberuehrt.
  await writeHubAgentStatus(db, account.id, name, { snmp });

  return NextResponse.json({ ok: true, ...stats });
}
