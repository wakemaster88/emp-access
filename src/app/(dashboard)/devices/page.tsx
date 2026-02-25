import { auth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HardDrive, Wifi, WifiOff, Cpu } from "lucide-react";

export default async function DevicesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);

  const devices = await db.device.findMany({
    where: isSuperAdmin ? {} : { accountId: session.user.accountId! },
    include: { _count: { select: { scans: true } } },
    orderBy: { name: "asc" },
  });

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  return (
    <>
      <Header title="Geräte" accountName={session.user.accountName} />
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {devices.length === 0 && (
            <div className="col-span-full text-center text-slate-500 py-12">
              Keine Geräte konfiguriert
            </div>
          )}
          {devices.map((device) => {
            const isOnline = device.lastUpdate && device.lastUpdate > fiveMinAgo;
            return (
              <Card key={device.id} className="border-slate-200 dark:border-slate-800">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                        device.type === "SHELLY"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                      }`}>
                        {device.type === "SHELLY" ? <Wifi className="h-5 w-5" /> : <Cpu className="h-5 w-5" />}
                      </div>
                      <div>
                        <CardTitle className="text-base">{device.name}</CardTitle>
                        <p className="text-xs text-slate-500 mt-0.5">{device.type === "SHELLY" ? "Shelly Relais" : "Raspberry Pi"}</p>
                      </div>
                    </div>
                    {isOnline ? (
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                        <Wifi className="h-3 w-3 mr-1" /> Online
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-slate-500">
                        <WifiOff className="h-3 w-3 mr-1" /> Offline
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Status</span>
                    <span className={device.isActive ? "text-emerald-600" : "text-rose-600"}>
                      {device.isActive ? "Aktiv" : "Inaktiv"}
                    </span>
                  </div>
                  {device.ipAddress && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">IP-Adresse</span>
                      <span className="font-mono text-xs">{device.ipAddress}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Task</span>
                    <Badge variant={device.task > 0 ? "default" : "secondary"} className="text-xs">
                      {device.task > 0 ? `Task #${device.task}` : "Idle"}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Scans gesamt</span>
                    <span className="font-semibold">{device._count.scans}</span>
                  </div>
                  {device.lastUpdate && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Letztes Update</span>
                      <span className="text-xs text-slate-400">
                        {device.lastUpdate.toLocaleString("de-DE")}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
