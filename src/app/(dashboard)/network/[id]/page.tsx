import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PortGrid } from "@/components/network/port-grid";
import { ArrowLeft, Server, MapPin, Globe, EthernetPort } from "lucide-react";

interface Props {
  params: Promise<{ id: string }>;
}

const TYPE_LABEL: Record<string, string> = {
  SWITCH: "Switch",
  ROUTER: "Router",
  ACCESS_POINT: "Access Point",
  FIREWALL: "Firewall",
  OTHER: "Sonstiges",
};

export default async function NetworkDeviceDetailPage({ params }: Props) {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/network");

  const { id } = await params;
  const deviceId = Number(id);
  if (isNaN(deviceId)) notFound();

  const accountId = session.user.accountId;
  const db = tenantClient(accountId);

  const [device, vlans, outlets] = await Promise.all([
    db.networkDevice.findFirst({
      where: { id: deviceId, accountId },
      include: {
        ports: {
          include: {
            vlan: { select: { id: true, vlanId: true, name: true } },
            taggedVlans: { include: { vlan: { select: { id: true, vlanId: true, name: true } } } },
            outlet: { select: { id: true, label: true } },
            client: { select: { id: true, name: true } },
          },
          orderBy: { number: "asc" },
        },
      },
    }),
    db.networkVlan.findMany({
      where: { accountId },
      select: { id: true, vlanId: true, name: true },
      orderBy: { vlanId: "asc" },
    }),
    db.networkOutlet.findMany({
      where: { accountId },
      select: { id: true, label: true, port: { select: { id: true } } },
      orderBy: { label: "asc" },
    }),
  ]);

  if (!device) notFound();

  const usedPorts = device.ports.filter((p) => p.client || p.outlet).length;

  return (
    <>
      <Header title={device.name} accountName={session.user.accountName} />
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <Link
          href="/network"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Zurück zum Netzwerk
        </Link>

        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="flex flex-wrap items-center gap-4 p-4 sm:p-6">
            <div className="h-12 w-12 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <Server className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{device.name}</h2>
                <Badge variant="secondary" className="text-xs">{TYPE_LABEL[device.type] ?? device.type}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-slate-500">
                {[device.vendor, device.model].filter(Boolean).length > 0 && (
                  <span>{[device.vendor, device.model].filter(Boolean).join(" ")}</span>
                )}
                {device.ipAddress && (
                  <span className="inline-flex items-center gap-1 font-mono">
                    <Globe className="h-3 w-3" />
                    {device.ipAddress}
                  </span>
                )}
                {device.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {device.location}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <EthernetPort className="h-3 w-3" />
                  {usedPorts} / {device.ports.length} Ports belegt
                </span>
              </div>
              {device.notes && (
                <p className="text-xs text-slate-400 mt-1">{device.notes}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-4">
            <CardTitle className="text-base sm:text-xl">Ports</CardTitle>
          </CardHeader>
          <CardContent>
            <PortGrid
              ports={device.ports.map((p) => ({
                id: p.id,
                number: p.number,
                label: p.label,
                poe: p.poe,
                uplink: p.uplink,
                status: p.status,
                notes: p.notes,
                vlan: p.vlan,
                taggedVlans: p.taggedVlans.map((tv) => tv.vlan),
                outlet: p.outlet,
                client: p.client,
              }))}
              vlans={vlans}
              outlets={outlets.map((o) => ({
                id: o.id,
                label: o.label,
                taken: !!o.port,
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
