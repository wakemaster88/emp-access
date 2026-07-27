import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { ingestHubScanDevices } from "@/lib/network-scan-ingest";

/**
 * POST (Hub, Token-Auth): nimmt das Ergebnis eines aktiven Netzwerk-Scans
 * entgegen und upserted die Geraete per (accountId, MAC). Body:
 * { hubName?, devices: [{ ip, mac, iface?, hostname?, vendor?, openPorts?,
 *   deviceType?, responseMs?, reachable? }] }
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const body = await request.json().catch(() => null);
  const rawDevices = Array.isArray(body?.devices) ? body.devices : null;
  if (!rawDevices) {
    return NextResponse.json({ error: "devices-Array fehlt" }, { status: 400 });
  }
  const hubName =
    typeof body.hubName === "string" && body.hubName.trim()
      ? body.hubName.trim().slice(0, 100)
      : null;

  const { processed, synced } = await ingestHubScanDevices(
    db,
    account.id,
    rawDevices,
    hubName
  );
  return NextResponse.json({ ok: true, processed, synced });
}
