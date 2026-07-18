import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

const MAX_DEVICES_PER_SCAN = 500;
const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

/**
 * POST (Hub, Token-Auth): nimmt das Ergebnis eines automatischen
 * Netzwerk-Scans entgegen und upserted die Geraete per (accountId, MAC).
 * Body: { hubName?: string, devices: [{ ip, mac, iface? }] }
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
  const hubName = typeof body.hubName === "string" ? body.hubName.slice(0, 100) : null;

  // Pro MAC nur ein Eintrag (letzter gewinnt), ungueltige MACs verwerfen.
  const byMac = new Map<string, { ip: string | null; iface: string | null }>();
  for (const d of rawDevices.slice(0, MAX_DEVICES_PER_SCAN)) {
    const mac = String(d?.mac ?? "").toUpperCase();
    if (!MAC_RE.test(mac)) continue;
    byMac.set(mac, {
      ip: typeof d.ip === "string" ? d.ip.slice(0, 45) : null,
      iface: typeof d.iface === "string" ? d.iface.slice(0, 30) : null,
    });
  }

  const now = new Date();
  let processed = 0;
  for (const [mac, info] of byMac) {
    await db.discoveredDevice.upsert({
      where: { accountId_macAddress: { accountId: account.id, macAddress: mac } },
      create: {
        macAddress: mac,
        ipAddress: info.ip,
        iface: info.iface,
        hubName,
        firstSeenAt: now,
        lastSeenAt: now,
        accountId: account.id,
      },
      update: {
        ipAddress: info.ip,
        iface: info.iface,
        hubName,
        lastSeenAt: now,
      },
    });
    processed++;
  }

  return NextResponse.json({ ok: true, processed });
}
