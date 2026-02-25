import { auth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Ticket, ScanLine, HardDrive, MapPin } from "lucide-react";
import { Header } from "@/components/layout/header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [ticketCount, scanCount, deviceCount, areaCount, recentScans] = await Promise.all([
    db.ticket.count({ where: { status: "VALID", ...(isSuperAdmin ? {} : { accountId: session.user.accountId! }) } }),
    db.scan.count({ where: { scanTime: { gte: today }, ...(isSuperAdmin ? {} : { accountId: session.user.accountId! }) } }),
    db.device.count({ where: { isActive: true, ...(isSuperAdmin ? {} : { accountId: session.user.accountId! }) } }),
    db.accessArea.count({ where: isSuperAdmin ? {} : { accountId: session.user.accountId! } }),
    db.scan.findMany({
      where: isSuperAdmin ? {} : { accountId: session.user.accountId! },
      include: { device: true, ticket: true },
      orderBy: { scanTime: "desc" },
      take: 10,
    }),
  ]);

  return (
    <>
      <Header title="Dashboard" accountName={session.user.accountName} />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Aktive Tickets" value={ticketCount} icon={Ticket} color="indigo" />
          <StatCard title="Scans heute" value={scanCount} icon={ScanLine} color="emerald" />
          <StatCard title="Geräte online" value={deviceCount} icon={HardDrive} color="amber" />
          <StatCard title="Zugangsbereiche" value={areaCount} icon={MapPin} color="rose" />
        </div>

        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader>
            <CardTitle className="text-lg">Letzte Scans</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentScans.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-8">Noch keine Scans vorhanden</p>
              )}
              {recentScans.map((scan) => (
                <div
                  key={scan.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800"
                >
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={scan.result === "GRANTED" ? "default" : scan.result === "PROTECTED" ? "secondary" : "destructive"}
                      className={
                        scan.result === "GRANTED"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : scan.result === "PROTECTED"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : ""
                      }
                    >
                      {scan.result === "GRANTED" ? "Erlaubt" : scan.result === "PROTECTED" ? "Geschützt" : "Abgelehnt"}
                    </Badge>
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {scan.ticket?.name || scan.code}
                      </p>
                      <p className="text-xs text-slate-500">{scan.device.name}</p>
                    </div>
                  </div>
                  <span className="text-xs text-slate-400">
                    {scan.scanTime.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
