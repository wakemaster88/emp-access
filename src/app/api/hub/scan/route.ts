import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { isVirtualMac } from "@/lib/oui";
import { findVlanForIp } from "@/lib/ip";

const MAX_DEVICES_PER_SCAN = 1000;
const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

/** Multicast-IPs (224.0.0.0/4) und Broadcast sind keine echten Geraete. */
function isVirtualIp(ip: string | null): boolean {
  if (!ip) return false;
  const firstOctet = Number(ip.split(".")[0]);
  return (firstOctet >= 224 && firstOctet <= 239) || ip.endsWith(".255");
}

interface DeviceInfo {
  ip: string | null;
  iface: string | null;
  hostname: string | null;
  vendor: string | null;
  openPorts: number[];
  deviceType: string | null;
  responseMs: number | null;
  reachable: boolean;
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function ports(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 65535)
    .slice(0, 100);
}

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
  const hubName = str(body.hubName, 100);

  // Pro MAC nur ein Eintrag (letzter gewinnt), ungueltige MACs verwerfen.
  const byMac = new Map<string, DeviceInfo>();
  for (const d of rawDevices.slice(0, MAX_DEVICES_PER_SCAN)) {
    const mac = String(d?.mac ?? "").toUpperCase();
    if (!MAC_RE.test(mac) || isVirtualMac(mac)) continue;
    if (isVirtualIp(typeof d.ip === "string" ? d.ip : null)) continue;
    const responseMs = Number(d?.responseMs);
    byMac.set(mac, {
      ip: str(d.ip, 45),
      iface: str(d.iface, 30),
      hostname: str(d.hostname, 255),
      vendor: str(d.vendor, 120),
      openPorts: ports(d.openPorts),
      deviceType: str(d.deviceType, 60),
      responseMs: Number.isFinite(responseMs) && responseMs >= 0 ? Math.round(responseMs) : null,
      reachable: d.reachable !== false,
    });
  }

  const now = new Date();
  let processed = 0;
  for (const [mac, info] of byMac) {
    const common = {
      ipAddress: info.ip,
      iface: info.iface,
      hostname: info.hostname,
      vendor: info.vendor,
      openPorts: info.openPorts,
      deviceType: info.deviceType,
      responseMs: info.responseMs,
      reachable: info.reachable,
      hubName,
      lastSeenAt: now,
    };
    await db.discoveredDevice.upsert({
      where: { accountId_macAddress: { accountId: account.id, macAddress: mac } },
      create: {
        macAddress: mac,
        firstSeenAt: now,
        accountId: account.id,
        ...common,
      },
      update: common,
    });
    processed++;
  }

  // Auto-Sync: Bei bekannten MACs die IP-Adresse der verwalteten Eintraege
  // aktuell halten (DHCP-Wechsel werden so automatisch nachgezogen) und das
  // VLAN aus dem Subnetz ableiten, sofern keines gesetzt ist.
  //
  // Zusaetzlich zum MAC-Abgleich matchen wir Infrastruktur (Switches/Router/
  // APs) auch ueber die IP-Adresse: NETGEAR-Switches melden ihre Management-
  // MAC oft mit einem Offset zur aufgedruckten Chassis-MAC, wuerden per MAC
  // also nie treffen. Bei fester Management-IP ist der IP-Abgleich zuverlaessig.
  let synced = 0;
  const macs = [...byMac.keys()];
  const byIp = new Map<string, { ip: string | null; iface: string | null }>();
  for (const info of byMac.values()) {
    if (info.ip) byIp.set(info.ip, info);
  }
  const ips = [...byIp.keys()];
  if (macs.length > 0) {
    const [managedClients, managedDevices, vlans] = await Promise.all([
      db.networkClient.findMany({
        where: { accountId: account.id, macAddress: { in: macs, mode: "insensitive" } },
        select: { id: true, macAddress: true, ipAddress: true, vlanId: true },
      }),
      db.networkDevice.findMany({
        where: {
          accountId: account.id,
          OR: [
            { macAddress: { in: macs, mode: "insensitive" } },
            ...(ips.length > 0 ? [{ ipAddress: { in: ips } }] : []),
          ],
        },
        select: { id: true, macAddress: true, ipAddress: true },
      }),
      db.networkVlan.findMany({
        where: { accountId: account.id, subnet: { not: null } },
        select: { id: true, subnet: true },
      }),
    ]);
    // Clients: nur per MAC abgleichen (DHCP-IPs sind nicht ortsfest).
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
    // Infrastruktur: MAC bevorzugt, sonst IP-Abgleich.
    for (const d of managedDevices) {
      const info =
        (d.macAddress ? byMac.get(d.macAddress.toUpperCase()) : undefined) ??
        (d.ipAddress ? byIp.get(d.ipAddress) : undefined);
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
