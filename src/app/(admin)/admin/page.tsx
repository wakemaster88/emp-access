import { auth } from "@/lib/auth";
import { superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, HardDrive, ScanLine } from "lucide-react";

export default async function AdminDashboardPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "SUPER_ADMIN") redirect("/");

  const db = superAdminClient;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [accountCount, adminCount, deviceCount, scanCount, accounts] = await Promise.all([
    db.account.count(),
    db.admin.count(),
    db.device.count({ where: { isActive: true } }),
    db.scan.count({ where: { scanTime: { gte: today } } }),
    db.account.findMany({
      include: {
        _count: { select: { admins: true, devices: true, tickets: true, scans: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <Header title="Superadmin Dashboard" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Mandanten" value={accountCount} icon={Building2} color="indigo" />
          <StatCard title="Administratoren" value={adminCount} icon={Users} color="emerald" />
          <StatCard title="Geräte aktiv" value={deviceCount} icon={HardDrive} color="amber" />
          <StatCard title="Scans heute" value={scanCount} icon={ScanLine} color="rose" />
        </div>

        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader>
            <CardTitle>Alle Mandanten</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {accounts.map((acc) => (
                <Card key={acc.id} className="border-slate-200 dark:border-slate-800">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100">{acc.name}</h3>
                      <Badge className={acc.isActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-rose-100 text-rose-700"}>
                        {acc.isActive ? "Aktiv" : "Inaktiv"}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 font-mono mb-3">{acc.subdomain}</p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-slate-500">Admins: <span className="font-medium text-slate-700 dark:text-slate-300">{acc._count.admins}</span></div>
                      <div className="text-slate-500">Geräte: <span className="font-medium text-slate-700 dark:text-slate-300">{acc._count.devices}</span></div>
                      <div className="text-slate-500">Tickets: <span className="font-medium text-slate-700 dark:text-slate-300">{acc._count.tickets}</span></div>
                      <div className="text-slate-500">Scans: <span className="font-medium text-slate-700 dark:text-slate-300">{acc._count.scans}</span></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
