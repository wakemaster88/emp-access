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

/** Eintrag der IP-Historie: fruehere IP + wann sie zuletzt gesehen wurde. */
interface IpHistoryEntry {
  ip: string;
  seenUntil: string;
}

const MAX_IP_HISTORY = 10;

/**
 * Alte IP in die Historie uebernehmen (neueste zuerst, pro IP nur der
 * juengste Eintrag, begrenzt auf MAX_IP_HISTORY).
 */
function pushIpHistory(history: unknown, ip: string | null, seenUntil: Date): IpHistoryEntry[] {
  const entries: IpHistoryEntry[] = Array.isArray(history)
    ? (history as IpHistoryEntry[]).filter((e) => e && typeof e.ip === "string")
    : [];
  if (!ip) return entries;
  return [
    { ip, seenUntil: seenUntil.toISOString() },
    ...entries.filter((e) => e.ip !== ip),
  ].slice(0, MAX_IP_HISTORY);
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

  // Bestehende Eintraege vorab laden, um IP-Wechsel zu erkennen: die alte IP
  // wandert dann in die Historie statt kommentarlos ueberschrieben zu werden.
  const existing = await db.discoveredDevice.findMany({
    where: { accountId: account.id, macAddress: { in: [...byMac.keys()] } },
    select: { macAddress: true, ipAddress: true, ipHistory: true, lastSeenAt: true },
  });
  const existingByMac = new Map(existing.map((e) => [e.macAddress, e]));

  let processed = 0;
  for (const [mac, info] of byMac) {
    const prev = existingByMac.get(mac);
    const ipChanged = !!prev && !!prev.ipAddress && !!info.ip && prev.ipAddress !== info.ip;
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
      ...(ipChanged
        ? { ipHistory: pushIpHistory(prev.ipHistory, prev.ipAddress, prev.lastSeenAt) }
        : {}),
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

  // Eine IP gehoert immer nur dem zuletzt gesehenen Geraet: haelt ein anderer
  // (aelterer) Eintrag dieselbe IP noch, gibt er sie an seine Historie ab.
  // Das passiert z. B. nach DHCP-Wechseln oder wenn Geraete das Subnetz
  // wechseln - sonst zeigen zwei Eintraege dieselbe "aktuelle" IP.
  const claimedIps = [...byMac.values()].map((i) => i.ip).filter((ip): ip is string => !!ip);
  if (claimedIps.length > 0) {
    const stale = await db.discoveredDevice.findMany({
      where: {
        accountId: account.id,
        ipAddress: { in: claimedIps },
        macAddress: { notIn: [...byMac.keys()] },
      },
      select: { id: true, ipAddress: true, ipHistory: true, lastSeenAt: true },
    });
    for (const s of stale) {
      await db.discoveredDevice.update({
        where: { id: s.id },
        data: {
          ipAddress: null,
          ipHistory: pushIpHistory(s.ipHistory, s.ipAddress, s.lastSeenAt),
        },
      });
    }
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
