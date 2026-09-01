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

  for (const sw of switches.slice(0, 20)) {
    const host = String(sw.host ?? "").trim();
    if (!host) continue;

    const device = await db.networkDevice.findFirst({
      where: { accountId, ipAddress: host },
      select: { id: true, name: true, ports: { select: { id: true, number: true } } },
    });
    if (device) {
      await db.networkDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: now },
      });
      devices++;

      const vlans = await db.networkVlan.findMany({
        where: { accountId },
        select: { id: true, vlanId: true },
      });
      const vlanByNum = new Map(vlans.map((v) => [v.vlanId, v.id]));
      const portByNumber = new Map(device.ports.map((p) => [p.number, p.id]));

      for (const p of sw.ports ?? []) {
        const n = Number(p.number);
        if (!Number.isInteger(n) || n <= 0) continue;
        const vlanDbId = p.pvid != null ? vlanByNum.get(p.pvid) ?? null : null;
        const existingId = portByNumber.get(n);
        if (existingId) {
          await db.networkPort.update({
            where: { id: existingId },
            data: {
              ...(vlanDbId ? { vlanId: vlanDbId } : {}),
            },
          });
          ports++;
        }
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

      for (const [portNum, macs] of macsPerPort) {
        const unique = [...new Set(macs)];
        const portId = portByNumber.get(portNum);
        if (!portId) continue;
        if (unique.length > 3) {
          await db.networkPort.update({
            where: { id: portId },
            data: { uplink: true },
          });
          continue;
        }
        for (const mac of unique) {
          const client = await db.networkClient.findFirst({
            where: { accountId, macAddress: mac },
            select: { id: true, portId: true },
          });
          if (client && client.portId !== portId) {
            const occupied = await db.networkClient.findFirst({
              where: { portId },
              select: { id: true },
            });
            if (!occupied || occupied.id === client.id) {
              await db.networkClient.update({
                where: { id: client.id },
                data: { portId, lastSeenAt: now },
              });
              clients++;
            }
          }
          const discovered = await db.discoveredDevice.findUnique({
            where: { accountId_macAddress: { accountId, macAddress: mac } },
            select: { macAddress: true },
          });
          if (discovered) {
            await db.discoveredDevice.update({
              where: { accountId_macAddress: { accountId, macAddress: mac } },
              data: {
                iface: `${device.name} p${portNum}`.slice(0, 30),
                lastSeenAt: now,
              },
            });
          }
        }
      }
    }
  }

  return { devices, ports, clients };
}
