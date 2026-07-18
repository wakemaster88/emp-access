import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { isVirtualMac } from "@/lib/oui";
import { findVlanForIp } from "@/lib/ip";

const MAX_DEVICES_PER_SCAN = 500;
const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

/** Multicast-IPs (224.0.0.0/4) und Broadcast sind keine echten Geraete. */
function isVirtualIp(ip: string | null): boolean {
  if (!ip) return false;
  const firstOctet = Number(ip.split(".")[0]);
  return (firstOctet >= 224 && firstOctet <= 239) || ip.endsWith(".255");
}

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
    if (!MAC_RE.test(mac) || isVirtualMac(mac)) continue;
    if (isVirtualIp(typeof d.ip === "string" ? d.ip : null)) continue;
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

  // Auto-Sync: Bei bekannten MACs die IP-Adresse der verwalteten Eintraege
  // aktuell halten (DHCP-Wechsel werden so automatisch nachgezogen) und das
  // VLAN aus dem Subnetz ableiten, sofern keines gesetzt ist.
  let synced = 0;
  const macs = [...byMac.keys()];
  if (macs.length > 0) {
    const [managedClients, managedDevices, vlans] = await Promise.all([
      db.networkClient.findMany({
        where: { accountId: account.id, macAddress: { in: macs, mode: "insensitive" } },
        select: { id: true, macAddress: true, ipAddress: true, vlanId: true },
      }),
      db.networkDevice.findMany({
        where: { accountId: account.id, macAddress: { in: macs, mode: "insensitive" } },
        select: { id: true, macAddress: true, ipAddress: true },
      }),
      db.networkVlan.findMany({
        where: { accountId: account.id, subnet: { not: null } },
        select: { id: true, subnet: true },
      }),
    ]);
    for (const c of managedClients) {
      const info = c.macAddress ? byMac.get(c.macAddress.toUpperCase()) : undefined;
      if (!info) continue;
      const data: { ipAddress?: string; vlanId?: number; lastSeenAt: Date } = { lastSeenAt: now };
      if (info.ip && info.ip !== c.ipAddress) data.ipAddress = info.ip;
      if (c.vlanId === null && info.ip) {
        const vlan = findVlanForIp(info.ip, vlans);
        if (vlan) data.vlanId = vlan.id;
      }
      await db.networkClient.update({ where: { id: c.id }, data });
      synced++;
    }
    for (const d of managedDevices) {
      const info = d.macAddress ? byMac.get(d.macAddress.toUpperCase()) : undefined;
      if (!info) continue;
      await db.networkDevice.update({
        where: { id: d.id },
        data: {
          lastSeenAt: now,
          ...(info.ip && info.ip !== d.ipAddress ? { ipAddress: info.ip } : {}),
        },
      });
      synced++;
    }
  }

  return NextResponse.json({ ok: true, processed, synced });
}
