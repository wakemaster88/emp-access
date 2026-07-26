import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { NetworkTabs } from "@/components/network/network-tabs";
import { Badge } from "@/components/ui/badge";
import { Network, Server, EthernetPort, Cable, Cpu } from "lucide-react";
import { macVendor, isVirtualMac } from "@/lib/oui";

export default async function NetworkPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const accountId = session.user.accountId;
  const db = tenantClient(accountId);

  const [networkDevices, vlans, areas, outlets, clients, iotDevices, hubAgents, discoveredDevices] = await Promise.all([
    db.networkDevice.findMany({
      where: { accountId },
      include: {
        ports: {
          select: {
            id: true,
            number: true,
            status: true,
            vlanId: true,
            outletId: true,
            client: { select: { id: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.networkVlan.findMany({
      where: { accountId },
      include: {
        _count: { select: { ports: true, taggedPorts: true, clients: true } },
      },
      orderBy: { vlanId: "asc" },
    }),
    db.networkArea.findMany({
      where: { accountId },
      include: { _count: { select: { clients: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.networkOutlet.findMany({
      where: { accountId },
      include: {
        port: {
          select: {
            id: true,
            number: true,
            device: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { label: "asc" },
    }),
    db.networkClient.findMany({
      where: { accountId },
      include: {
        device: { select: { id: true, name: true, type: true, ipAddress: true, lastUpdate: true } },
        port: {
          select: {
            id: true,
            number: true,
            device: { select: { id: true, name: true } },
          },
        },
        vlan: { select: { id: true, vlanId: true, name: true } },
        area: { select: { id: true, name: true, sortOrder: true, vlanId: true } },
      },
      orderBy: { name: "asc" },
    }),
    // IoT-/Zutrittsgeraete fuer die kombinierte Geraete-Ansicht und die
    // Verknuepfungs-Auswahl im Dialog.
    db.device.findMany({
      where: { accountId },
      select: { id: true, name: true, type: true, ipAddress: true, lastUpdate: true, isActive: true, systemInfo: true },
      orderBy: { name: "asc" },
    }),
    db.hubAgent.findMany({
      where: { accountId },
      select: { id: true, name: true, hostname: true, version: true, lastSeenAt: true },
      orderBy: { name: "asc" },
    }),
    db.discoveredDevice.findMany({
      where: { accountId },
      orderBy: { lastSeenAt: "desc" },
    }),
  ]);

  // Flache Port-Liste (fuer Port-Auswahl im Geraete-Dialog).
  const allPorts = networkDevices.flatMap((d) =>
    d.ports.map((p) => ({
      id: p.id,
      number: p.number,
      deviceName: d.name,
      occupied: !!p.client,
    }))
  );

  const totalPorts = allPorts.length;
  const usedPorts = networkDevices.reduce(
    (sum, d) => sum + d.ports.filter((p) => p.client || p.outletId).length,
    0
  );

  const stats = [
    { label: "Switches & Router", value: networkDevices.length, icon: Server, color: "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10" },
    { label: "VLANs", value: vlans.length, icon: Network, color: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" },
    { label: "Ports (belegt)", value: totalPorts > 0 ? `${usedPorts} / ${totalPorts}` : "0", icon: EthernetPort, color: "text-amber-600 dark:text-amber-400 bg-amber-500/10" },
    { label: "Anschlüsse", value: outlets.length, icon: Cable, color: "text-sky-600 dark:text-sky-400 bg-sky-500/10" },
  ];

  const fiveMinAgo = new Date();
  fiveMinAgo.setMinutes(fiveMinAgo.getMinutes() - 5);

  // Auto-Matching der entdeckten Geraete gegen den verwalteten Bestand:
  // MAC gegen Switches/APs und Netzwerk-Clients, IP gegen IoT-Geraete.
  const norm = (mac: string | null) => mac?.toUpperCase() ?? "";
  const infraByMac = new Map(
    networkDevices.filter((d) => d.macAddress).map((d) => [norm(d.macAddress), d])
  );
  // Infrastruktur zusaetzlich per (Management-)IP: NETGEAR-Switches melden
  // im Scan oft eine MAC mit Offset zur aufgedruckten Chassis-MAC.
  const infraByIp = new Map(
    networkDevices.filter((d) => d.ipAddress).map((d) => [d.ipAddress!, d])
  );
  const clientByMac = new Map(
    clients.filter((c) => c.macAddress).map((c) => [norm(c.macAddress), c])
  );
  // Verwaltete Geraete (IoT/Scanner) per IP. Neben dem festen ipAddress-Feld
  // auch die vom Geraet selbst gemeldete Live-IP aus systemInfo.network.ip -
  // so werden z. B. Raspberry-Pi-Scanner erkannt, die keine feste IP im
  // Feld haben, ihre aktuelle IP aber im Heartbeat melden.
  const deviceByIp = new Map<string, { id: number; name: string }>();
  for (const d of iotDevices) {
    const sysIp = (d.systemInfo as { network?: { ip?: string } } | null)?.network?.ip;
    // Festes Feld hat Vorrang; Live-IP nur setzen, wenn noch nichts belegt ist.
    if (d.ipAddress && !deviceByIp.has(d.ipAddress)) deviceByIp.set(d.ipAddress, { id: d.id, name: d.name });
    if (sysIp && !deviceByIp.has(sysIp)) deviceByIp.set(sysIp, { id: d.id, name: d.name });
  }

  const discoveredRows = discoveredDevices
    .filter((d) => !isVirtualMac(d.macAddress))
    .map((d) => {
      const infra =
        infraByMac.get(norm(d.macAddress)) ??
        (d.ipAddress ? infraByIp.get(d.ipAddress) : undefined);
      const client = clientByMac.get(norm(d.macAddress));
      const device = d.ipAddress ? deviceByIp.get(d.ipAddress) : undefined;
      return {
        id: d.id,
        macAddress: d.macAddress,
        ipAddress: d.ipAddress,
        iface: d.iface,
        hostname: d.hostname,
        openPorts: Array.isArray(d.openPorts) ? (d.openPorts as number[]) : [],
        ipHistory: Array.isArray(d.ipHistory)
          ? (d.ipHistory as { ip: string; seenUntil: string }[])
          : [],
        deviceType: d.deviceType,
        responseMs: d.responseMs,
        reachable: d.reachable,
        hubName: d.hubName,
        firstSeenAt: d.firstSeenAt.toISOString(),
        lastSeenAt: d.lastSeenAt.toISOString(),
        vendor: d.vendor ?? macVendor(d.macAddress),
        match: infra
          ? { kind: "infra" as const, name: infra.name }
          : client
            ? { kind: "client" as const, name: client.name }
            : device
              ? { kind: "device" as const, name: device.name }
              : null,
      };
    });

  return (
    <>
      <Header title="Netzwerk" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Lokaler Hub-Status */}
        {hubAgents.length > 0 && (
          <Card className="border-slate-200 dark:border-slate-800">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="h-10 w-10 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                <Cpu className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Lokaler Hub</p>
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                  {hubAgents.map((h) => {
                    const online = !!h.lastSeenAt && h.lastSeenAt > fiveMinAgo;
                    return (
                      <span key={h.id} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                        {online ? (
                          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1 text-xs h-5">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {h.name}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-slate-400 gap-1 text-xs h-5">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> {h.name}
                          </Badge>
                        )}
                        {h.version && <span className="font-mono">({h.version})</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {stats.map((s) => (
            <Card key={s.label} className="border-slate-200 dark:border-slate-800">
              <CardContent className="flex items-center gap-3 p-4">
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${s.color}`}>
                  <s.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-tight">{s.value}</p>
                  <p className="text-xs text-slate-500 truncate">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <NetworkTabs
          networkDevices={networkDevices.map((d) => ({
            id: d.id,
            name: d.name,
            type: d.type,
            vendor: d.vendor,
            model: d.model,
            ipAddress: d.ipAddress,
            macAddress: d.macAddress,
            location: d.location,
            notes: d.notes,
            portCount: d.ports.length,
            usedPorts: d.ports.filter((p) => p.client || p.outletId).length,
            lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
          }))}
          vlans={vlans.map((v) => ({
            id: v.id,
            vlanId: v.vlanId,
            name: v.name,
            subnet: v.subnet,
            gateway: v.gateway,
            description: v.description,
            portCount: v._count.ports,
            taggedPortCount: v._count.taggedPorts,
            clientCount: v._count.clients,
          }))}
          areas={areas.map((a) => ({
            id: a.id,
            name: a.name,
            sortOrder: a.sortOrder,
            description: a.description,
            vlanId: a.vlanId,
            ipFrom: a.ipFrom,
            ipTo: a.ipTo,
            clientCount: a._count.clients,
          }))}
          outlets={outlets.map((o) => ({
            id: o.id,
            label: o.label,
            location: o.location,
            type: o.type,
            notes: o.notes,
            port: o.port
              ? { id: o.port.id, number: o.port.number, deviceId: o.port.device.id, deviceName: o.port.device.name }
              : null,
          }))}
          clients={clients.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            ipAddress: c.ipAddress,
            macAddress: c.macAddress,
            isStatic: c.isStatic,
            notes: c.notes,
            lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
            device: c.device
              ? {
                  id: c.device.id,
                  name: c.device.name,
                  type: c.device.type,
                  ipAddress: c.device.ipAddress,
                  lastUpdate: c.device.lastUpdate?.toISOString() ?? null,
                }
              : null,
            port: c.port
              ? { id: c.port.id, number: c.port.number, deviceId: c.port.device.id, deviceName: c.port.device.name }
              : null,
            vlan: c.vlan,
            area: c.area,
          }))}
          iotDevices={iotDevices.map((d) => ({
            id: d.id,
            name: d.name,
            type: d.type,
            ipAddress: d.ipAddress,
            lastUpdate: d.lastUpdate?.toISOString() ?? null,
            isActive: d.isActive,
          }))}
          allPorts={allPorts}
          discoveredDevices={discoveredRows}
        />
      </div>
    </>
  );
}
