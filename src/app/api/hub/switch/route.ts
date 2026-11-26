import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-token-auth";
import { ingestSwitchSnapshots, type SwitchIngestPayload } from "@/lib/snmp-ingest";
import { writeHubAgentStatus } from "@/lib/hub-agent-status";
import { failedSwitches, snmpStatusSummary } from "@/lib/hub-status";

/**
 * POST (Hub): SNMP-Snapshot der Switches. Aktualisiert NetworkDevice/Ports
 * (`ingestSwitchSnapshots`) und legt in HubAgent.status.snmp eine
 * Kurzfassung ab: Zeitpunkt, Zahlen des Abgleichs und je Switch Name,
 * Abfragezeit, Anzahl Ports, verbundene Ports, MAC-Eintraege und Fehler.
 * Ports und MAC-Tabellen stehen nur in den Netzwerk-Tabellen.
 *
 * `failed` (neuere Hubs): Switches ohne Antwort als `{ host, error }`. Sie
 * stehen mit ihrem Fehler in der Kurzfassung; der Abgleich ueberspringt sie
 * (kein lastSeenAt, keine Port- oder Zuordnungsaenderung). Ein Switch mit
 * `partial: ["fdb"]` hat eine leere MAC-Tabelle geliefert: Er kommt ohne
 * Tabelle, nur mit `macs` und `macsAt` der vorigen.
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
  const failed = failedSwitches(body.failed);
  const all = [...switches, ...failed];

  const stats = await ingestSwitchSnapshots(db, account.id, all);

  const snmp = { at: new Date().toISOString(), stats, switches: snmpStatusSummary(all) };

  // Zeile anlegen bzw. lastSeenAt und `status.snmp` setzen, in einer
  // Anweisung; die uebrigen Teile von status bleiben unberuehrt.
  await writeHubAgentStatus(db, account.id, name, { snmp });

  return NextResponse.json({ ok: true, ...stats });
}
