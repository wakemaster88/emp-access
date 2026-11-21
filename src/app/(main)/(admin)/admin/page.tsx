import { safeAuth } from "@/lib/auth";
import { superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
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
      <div className="page-content space-y-4 sm:space-y-5">
        {/* Kennzahlen in Akzentfarbe; keine Zustandsfarben für reine Zähler (docs/design-regeln.md, Abschnitt 3). */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard label="Mandanten" value={accountCount} icon={Building2} tone="primary" />
          <StatCard label="Administratoren" value={adminCount} icon={Users} tone="primary" />
          <StatCard label="Geräte aktiv" value={deviceCount} icon={HardDrive} tone="primary" />
          <StatCard label="Scans heute" value={scanCount} icon={ScanLine} tone="primary" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Alle Mandanten</CardTitle>
          </CardHeader>
          <CardContent>
            {accounts.length === 0 && (
              <EmptyState compact icon={Building2} title="Keine Mandanten vorhanden" />
            )}
            {/* Mandanten als Glas-Kacheln in der Karte statt verschachtelter Karten (Abschnitt 14). */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {accounts.map((acc) => (
                <Link
                  key={acc.id}
                  href="/admin/accounts"
                  className="block rounded-tile outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                <div className="glass-tile press h-full p-4 hover:border-primary/60">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <h3 className="min-w-0 break-words font-semibold text-foreground">{acc.name}</h3>
                      <Badge variant={acc.isActive ? "success" : "neutral"}>
                        {acc.isActive ? "Aktiv" : "Inaktiv"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mb-3">{acc.subdomain}</p>
                    <div className="grid grid-cols-2 gap-2 text-sm tabular-nums">
                      <div className="text-muted-foreground">Admins: <span className="font-medium text-foreground">{acc._count.admins}</span></div>
                      <div className="text-muted-foreground">Geräte: <span className="font-medium text-foreground">{acc._count.devices}</span></div>
                      <div className="text-muted-foreground">Tickets: <span className="font-medium text-foreground">{acc._count.tickets}</span></div>
                      <div className="text-muted-foreground">Scans: <span className="font-medium text-foreground">{acc._count.scans}</span></div>
                    </div>
                </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
