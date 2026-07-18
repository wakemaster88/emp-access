import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { NetworkTabs } from "@/components/network/network-tabs";
import { Network, Server, EthernetPort, Cable } from "lucide-react";

export default async function NetworkPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const accountId = session.user.accountId;
  const db = tenantClient(accountId);

  const [networkDevices, vlans, outlets, clients, iotDevices] = await Promise.all([
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
      },
      orderBy: { name: "asc" },
    }),
    // IoT-/Zutrittsgeraete fuer die kombinierte Geraete-Ansicht und die
    // Verknuepfungs-Auswahl im Dialog.
    db.device.findMany({
      where: { accountId },
      select: { id: true, name: true, type: true, ipAddress: true, lastUpdate: true, isActive: true },
      orderBy: { name: "asc" },
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

  return (
    <>
      <Header title="Netzwerk" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
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
        />
      </div>
    </>
  );
}
