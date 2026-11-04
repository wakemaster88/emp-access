import { isVirtualMac } from "@/lib/oui";
import { macSpellings, normalizeMac } from "@/lib/mac";
import { findVlanForIp } from "@/lib/ip";
import type { tenantClient } from "@/lib/prisma";
import { alertNewDevices } from "@/lib/new-device-alert";

type Db = ReturnType<typeof tenantClient>;

const MAX_DEVICES_PER_SCAN = 1000;
const MAX_IP_HISTORY = 10;

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

/**
 * Bewusst ein Type-Alias und kein Interface: nur Aliase bekommen von
 * TypeScript einen impliziten Index-Signature und passen damit in Prismas
 * `InputJsonValue` der JSON-Spalte `ipHistory`.
 */
type IpHistoryEntry = {
  ip: string;
  seenUntil: string;
};

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
 * Hub-Scan-Ergebnisse (Auto-Scan oder NETWORK_SCAN-Task) in DiscoveredDevice
 * schreiben und bekannte Clients/Infra per MAC/IP aktualisieren.
 *
 * Eintraege ohne MAC kommen aus gerouteten VLANs (der Hub sieht dort keine
 * ARP-Tabelle). Sie landen nicht in DiscoveredDevice (Schluessel ist die MAC),
 * markieren aber bekannte Clients/Infra mit genau dieser IP als gesehen.
 */
const ABSENT_SCANS_BEFORE_PRUNE = 2;

export async function ingestHubScanDevices(
  db: Db,
  accountId: number,
  rawDevices: unknown[],
  hubName: string | null = null
): Promise<{ processed: number; synced: number; pruned: number }> {
  const byMac = new Map<string, DeviceInfo>();
  /** Erreichbare Geraete ohne MAC (geroutete VLANs), per IP. */
  const ipOnly = new Map<string, DeviceInfo>();
  for (const d of rawDevices.slice(0, MAX_DEVICES_PER_SCAN)) {
    const row = d as Record<string, unknown> | null;
    const ip = str(row?.ip, 45);
    if (isVirtualIp(ip)) continue;
    const responseMs = Number(row?.responseMs);
    const info: DeviceInfo = {
      ip,
      iface: str(row?.iface, 30),
      hostname: str(row?.hostname, 255),
      vendor: str(row?.vendor, 120),
      openPorts: ports(row?.openPorts),
      deviceType: str(row?.deviceType, 60),
      responseMs: Number.isFinite(responseMs) && responseMs >= 0 ? Math.round(responseMs) : null,
      reachable: row?.reachable !== false,
    };
    const mac = normalizeMac(row?.mac);
    if (mac) {
      if (!isVirtualMac(mac)) byMac.set(mac, info);
    } else if (ip && info.reachable) {
      ipOnly.set(ip, info);
    }
  }

  if (byMac.size === 0 && ipOnly.size === 0) return { processed: 0, synced: 0, pruned: 0 };

  const now = new Date();
  const existing = await db.discoveredDevice.findMany({
    where: { accountId, macAddress: { in: [...byMac.keys()] } },
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
      absentScans: 0,
      hubName,
      lastSeenAt: now,
      ...(ipChanged
        ? { ipHistory: pushIpHistory(prev.ipHistory, prev.ipAddress, prev.lastSeenAt) }
        : {}),
    };
    await db.discoveredDevice.upsert({
      where: { accountId_macAddress: { accountId, macAddress: mac } },
      create: {
        macAddress: mac,
        firstSeenAt: now,
        accountId,
        ...common,
      },
      update: common,
    });
    processed++;
  }

  // Neue, bisher nie gesehene MACs per Telegram melden (nur melden, nie sperren).
  try {
    await alertNewDevices(db, accountId, byMac);
  } catch (err) {
    console.error("[scan-ingest] Neu-Geraete-Meldung fehlgeschlagen:", err);
  }

  const claimedIps = [...byMac.values()].map((i) => i.ip).filter((ip): ip is string => !!ip);
  if (claimedIps.length > 0) {
    const stale = await db.discoveredDevice.findMany({
      where: {
        accountId,
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

  let synced = 0;
  const macs = [...byMac.keys()];
  const spellings = macSpellings(macs);
  /** IP -> MAC aus diesem Scan, um IP-Treffer mit fremder MAC zu erkennen. */
  const macByIp = new Map<string, string>();
  for (const [mac, info] of byMac) {
    if (info.ip) macByIp.set(info.ip, mac);
  }
  const ipOnlyIps = [...ipOnly.keys()];
  const allIps = [...macByIp.keys(), ...ipOnlyIps];
  if (spellings.length > 0 || ipOnlyIps.length > 0) {
    // Bewusst kein `mode: "insensitive"` beim `in`: das findet unter Prisma 7
    // nichts (siehe lib/mac.ts). Stattdessen alle Schreibweisen abfragen.
    const [managedClients, managedDevices, vlans] = await Promise.all([
      db.networkClient.findMany({
        where: {
          accountId,
          OR: [
            ...(spellings.length > 0 ? [{ macAddress: { in: spellings } }] : []),
            ...(ipOnlyIps.length > 0 ? [{ ipAddress: { in: ipOnlyIps } }] : []),
          ],
        },
        select: { id: true, macAddress: true, ipAddress: true, vlanId: true },
      }),
      db.networkDevice.findMany({
        where: {
          accountId,
          OR: [
            ...(spellings.length > 0 ? [{ macAddress: { in: spellings } }] : []),
            ...(allIps.length > 0 ? [{ ipAddress: { in: allIps } }] : []),
          ],
        },
        select: { id: true, macAddress: true, ipAddress: true },
      }),
      db.networkVlan.findMany({
        where: { accountId, subnet: { not: null } },
        select: { id: true, subnet: true },
      }),
    ]);

    /**
     * Scan-Treffer fuer einen bekannten Eintrag: zuerst per MAC (dann darf
     * die IP nachgezogen werden), sonst per IP. Ein IP-Treffer zaehlt nicht,
     * wenn dort laut Scan ein Geraet mit anderer MAC antwortet.
     */
    const match = (macRaw: string | null, ip: string | null) => {
      const mac = normalizeMac(macRaw);
      const viaMac = mac ? byMac.get(mac) : undefined;
      if (viaMac) return { info: viaMac, viaMac: true };
      if (!ip) return null;
      const macAtIp = macByIp.get(ip);
      if (macAtIp && (!mac || macAtIp === mac)) return { info: byMac.get(macAtIp)!, viaMac: false };
      const routed = ipOnly.get(ip);
      return routed ? { info: routed, viaMac: false } : null;
    };

    for (const c of managedClients) {
      const hit = match(c.macAddress, c.ipAddress);
      if (!hit) continue;
      const data: { ipAddress?: string; vlanId?: number; lastSeenAt: Date } = { lastSeenAt: now };
      const ip = hit.viaMac && hit.info.ip ? hit.info.ip : c.ipAddress;
      if (ip && ip !== c.ipAddress) data.ipAddress = ip;
      // VLAN folgt der IP (z. B. Kamera von VLAN 1 nach 30 umgezogen).
      const vlan = findVlanForIp(ip, vlans);
      if (vlan && vlan.id !== c.vlanId) data.vlanId = vlan.id;
      await db.networkClient.update({ where: { id: c.id }, data });
      synced++;
    }
    for (const d of managedDevices) {
      const hit = match(d.macAddress, d.ipAddress);
      if (!hit) continue;
      const ip = hit.viaMac && hit.info.ip ? hit.info.ip : d.ipAddress;
      await db.networkDevice.update({
        where: { id: d.id },
        data: {
          lastSeenAt: now,
          ...(ip && ip !== d.ipAddress ? { ipAddress: ip } : {}),
        },
      });
      synced++;
    }
  }

  // Fehlende Hosts: absentScans++. Unzugeordnete nach 2 Scans in Folge loeschen
  // (gleiche Zuordnungslogik wie in der UI: Client/Infra per MAC, IoT per IP).
  // Nur MAC-lose Eintraege (geroutete VLANs) sagen nichts ueber fehlende MACs.
  if (byMac.size === 0) return { processed, synced, pruned: 0 };
  const missing = await db.discoveredDevice.findMany({
    where: { accountId, macAddress: { notIn: [...byMac.keys()] } },
    select: { id: true, macAddress: true, ipAddress: true, absentScans: true },
  });
  let pruned = 0;
  if (missing.length > 0) {
    const missingMacs = missing.map((m) => m.macAddress);
    const missingIps = missing.map((m) => m.ipAddress).filter((ip): ip is string => !!ip);
    const [knownClients, knownInfra, knownIot] = await Promise.all([
      db.networkClient.findMany({
        where: { accountId, macAddress: { in: macSpellings(missingMacs) } },
        select: { macAddress: true },
      }),
      db.networkDevice.findMany({
        where: { accountId, macAddress: { in: macSpellings(missingMacs) } },
        select: { macAddress: true },
      }),
      missingIps.length > 0
        ? db.device.findMany({
            where: { accountId, ipAddress: { in: missingIps } },
            select: { ipAddress: true },
          })
        : Promise.resolve([] as { ipAddress: string | null }[]),
    ]);
    const assignedMacs = new Set(
      [...knownClients, ...knownInfra]
        .map((x) => normalizeMac(x.macAddress))
        .filter((m): m is string => !!m)
    );
    const assignedIps = new Set(
      knownIot.map((d) => d.ipAddress).filter((ip): ip is string => !!ip)
    );

    const toDelete: number[] = [];
    for (const m of missing) {
      const next = m.absentScans + 1;
      const isAssigned =
        assignedMacs.has(m.macAddress.toUpperCase()) ||
        (!!m.ipAddress && assignedIps.has(m.ipAddress));
      if (!isAssigned && next >= ABSENT_SCANS_BEFORE_PRUNE) {
        toDelete.push(m.id);
        continue;
      }
      await db.discoveredDevice.update({
        where: { id: m.id },
        data: { absentScans: next, reachable: false },
      });
    }
    if (toDelete.length > 0) {
      const del = await db.discoveredDevice.deleteMany({ where: { id: { in: toDelete } } });
      pruned = del.count;
    }
  }

  return { processed, synced, pruned };
}
