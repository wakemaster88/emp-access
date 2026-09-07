import { safeAuth } from "@/lib/auth";
import { superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, HardDrive, ScanLine } from "lucide-react";
import Link from "next/link";

export default async function AdminDashboardPage() {
  const session = await safeAuth();
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
      <div className="page-content space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Mandanten" value={accountCount} icon={Building2} tone="primary" />
          <StatCard label="Administratoren" value={adminCount} icon={Users} tone="success" />
          <StatCard label="Geräte aktiv" value={deviceCount} icon={HardDrive} tone="warning" />
          <StatCard label="Scans heute" value={scanCount} icon={ScanLine} tone="danger" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Alle Mandanten</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {accounts.map((acc) => (
                <Link key={acc.id} href="/admin/accounts">
                <Card className="hover:border-primary/60 transition-colors cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-foreground">{acc.name}</h3>
                      <Badge className={acc.isActive ? "bg-success/12 text-success" : "bg-destructive/10 text-destructive"}>
                        {acc.isActive ? "Aktiv" : "Inaktiv"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mb-3">{acc.subdomain}</p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-muted-foreground">Admins: <span className="font-medium text-foreground/80">{acc._count.admins}</span></div>
                      <div className="text-muted-foreground">Geräte: <span className="font-medium text-foreground/80">{acc._count.devices}</span></div>
                      <div className="text-muted-foreground">Tickets: <span className="font-medium text-foreground/80">{acc._count.tickets}</span></div>
                      <div className="text-muted-foreground">Scans: <span className="font-medium text-foreground/80">{acc._count.scans}</span></div>
                    </div>
                  </CardContent>
                </Card>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
