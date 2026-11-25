import type { Prisma } from "@prisma/client";
import type { tenantClient } from "@/lib/prisma";

type Db = ReturnType<typeof tenantClient>;

const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

export interface SwitchIngestPayload {
  host: string;
  sysName?: string | null;
  ports?: Array<{ number: number; descr?: string; up?: boolean; pvid?: number | null }>;
  macTable?: Array<{ mac: string; port: number; vlan?: number | null }>;
}

function macNorm(raw: string): string | null {
  const mac = raw.trim().toUpperCase().replace(/-/g, ":");
  return MAC_RE.test(mac) ? mac : null;
}

/**
 * SNMP-Snapshot: vorhandene NetworkDevices per IP, Ports/PVID, Client-Port
 * bei eindeutiger MAC, DiscoveredDevice.iface als Switch-Port.
 *
 * Switches, Ports, Clients und gefundene Geräte werden einmal vorab geladen;
 * geschrieben wird nur, was sich ändert, gebündelt in einer Transaktion je
 * Switch. Die Reihenfolge der Schreibvorgänge entspricht dem früheren
 * Ablauf Zeile für Zeile (spätere Switches und Ports gewinnen).
 */
export async function ingestSwitchSnapshots(
  db: Db,
  accountId: number,
  switches: SwitchIngestPayload[]
): Promise<{ devices: number; ports: number; clients: number }> {
  let devices = 0;
  let ports = 0;
  let clients = 0;
  const now = new Date();

  const list = switches
    .slice(0, 20)
    .map((sw) => ({ sw, host: String(sw.host ?? "").trim() }))
    .filter((x) => x.host);
  if (list.length === 0) return { devices, ports, clients };

  const deviceRows = await db.networkDevice.findMany({
    where: { accountId, ipAddress: { in: [...new Set(list.map((x) => x.host))] } },
    orderBy: { id: "asc" },
    select: { id: true, name: true, ipAddress: true, ports: { select: { id: true, number: true, vlanId: true, uplink: true } } },
  });
  const deviceByIp = new Map<string, (typeof deviceRows)[number]>();
  for (const d of deviceRows) if (d.ipAddress && !deviceByIp.has(d.ipAddress)) deviceByIp.set(d.ipAddress, d);
  if (!list.some((x) => deviceByIp.has(x.host))) return { devices, ports, clients };

  const allMacs = new Set<string>();
  for (const { sw, host } of list) {
    if (!deviceByIp.has(host)) continue;
    for (const row of sw.macTable ?? []) {
      const mac = macNorm(row.mac);
      if (mac) allMacs.add(mac);
    }
  }
  const portIds = deviceRows.flatMap((d) => d.ports.map((p) => p.id));
  const [vlans, clientRows, discoveredRows] = await Promise.all([
    db.networkVlan.findMany({ where: { accountId }, select: { id: true, vlanId: true } }),
    db.networkClient.findMany({
      where: {
        accountId,
        OR: [
          ...(allMacs.size > 0 ? [{ macAddress: { in: [...allMacs] } }] : []),
          ...(portIds.length > 0 ? [{ portId: { in: portIds } }] : []),
        ],
      },
      orderBy: { id: "asc" },
      select: { id: true, macAddress: true, portId: true },
    }),
    allMacs.size > 0
      ? db.discoveredDevice.findMany({ where: { accountId, macAddress: { in: [...allMacs] } }, select: { macAddress: true } })
      : Promise.resolve([] as { macAddress: string }[]),
  ]);
  const vlanByNum = new Map(vlans.map((v) => [v.vlanId, v.id]));
  /** Erster Client je MAC (wie früher findFirst) mit aktuellem Port. */
  const clientByMac = new Map<string, { id: number; portId: number | null }>();
  /** Belegte Ports: Port -> Client (portId ist eindeutig). */
  const clientOnPort = new Map<number, number>();
  for (const c of clientRows) {
    if (c.macAddress && !clientByMac.has(c.macAddress)) clientByMac.set(c.macAddress, { id: c.id, portId: c.portId });
    if (c.portId != null) clientOnPort.set(c.portId, c.id);
  }
  const discovered = new Set(discoveredRows.map((d) => d.macAddress));

  for (const { sw, host } of list) {
    const device = deviceByIp.get(host);
    if (!device) continue;
    const ops: Prisma.PrismaPromise<unknown>[] = [
      db.networkDevice.update({ where: { id: device.id }, data: { lastSeenAt: now } }),
    ];
    devices++;

    const portByNumber = new Map(device.ports.map((p) => [p.number, p]));

    // PVID: letzter Wert je Port, geschrieben nur bei echter Änderung, je VLAN gebündelt.
    const nextVlan = new Map<(typeof device.ports)[number], number>();
    for (const p of sw.ports ?? []) {
      const n = Number(p.number);
      if (!Number.isInteger(n) || n <= 0) continue;
      const vlanDbId = p.pvid != null ? vlanByNum.get(p.pvid) ?? null : null;
      const port = portByNumber.get(n);
      if (port) {
        if (vlanDbId) nextVlan.set(port, vlanDbId);
        ports++;
      }
    }
    const vlanChanges = new Map<number, number[]>();
    for (const [port, vlanId] of nextVlan) {
      if (port.vlanId === vlanId) continue;
      port.vlanId = vlanId;
      const ids = vlanChanges.get(vlanId) ?? [];
      ids.push(port.id);
      vlanChanges.set(vlanId, ids);
    }
    for (const [vlanId, ids] of vlanChanges) {
      ops.push(db.networkPort.updateMany({ where: { id: { in: ids } }, data: { vlanId } }));
    }

    const macsPerPort = new Map<number, string[]>();
    for (const row of sw.macTable ?? []) {
      const mac = macNorm(row.mac);
      const portNum = Number(row.port);
      if (!mac || !Number.isInteger(portNum)) continue;
      const list = macsPerPort.get(portNum) ?? [];
      list.push(mac);
      macsPerPort.set(portNum, list);
    }

    const uplinks: number[] = [];
    /** MAC -> Switch-Port als iface (spätere Ports gewinnen wie früher). */
    const ifaceByMac = new Map<string, string>();
    for (const [portNum, macs] of macsPerPort) {
      const unique = [...new Set(macs)];
      const port = portByNumber.get(portNum);
      if (!port) continue;
      const portId = port.id;
      if (unique.length > 3) {
        if (!port.uplink) {
          port.uplink = true;
          uplinks.push(portId);
        }
        continue;
      }
      for (const mac of unique) {
        const client = clientByMac.get(mac);
        if (client && client.portId !== portId) {
          const occupied = clientOnPort.get(portId);
          if (occupied == null || occupied === client.id) {
            if (client.portId != null && clientOnPort.get(client.portId) === client.id) clientOnPort.delete(client.portId);
            client.portId = portId;
            clientOnPort.set(portId, client.id);
            ops.push(db.networkClient.update({ where: { id: client.id }, data: { portId, lastSeenAt: now } }));
            clients++;
          }
        }
        if (discovered.has(mac)) ifaceByMac.set(mac, `${device.name} p${portNum}`.slice(0, 30));
      }
    }
    if (uplinks.length > 0) ops.push(db.networkPort.updateMany({ where: { id: { in: uplinks } }, data: { uplink: true } }));

    const macsByIface = new Map<string, string[]>();
    for (const [mac, iface] of ifaceByMac) {
      const macs = macsByIface.get(iface) ?? [];
      macs.push(mac);
      macsByIface.set(iface, macs);
    }
    for (const [iface, macs] of macsByIface) {
      ops.push(db.discoveredDevice.updateMany({ where: { accountId, macAddress: { in: macs } }, data: { iface, lastSeenAt: now } }));
    }

    await db.$transaction(ops);
  }

  return { devices, ports, clients };
}
