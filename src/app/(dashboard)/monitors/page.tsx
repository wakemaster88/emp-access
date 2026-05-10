import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { MonitorManager } from "@/components/settings/monitor-manager";

export const dynamic = "force-dynamic";

export default async function MonitorsPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const db = tenantClient(session.user.accountId);

  const [monitors, devices, accessAreas] = await Promise.all([
    db.monitorConfig.findMany({
      where: { accountId: session.user.accountId },
      orderBy: { createdAt: "desc" },
    }),
    db.device.findMany({
      where: { accountId: session.user.accountId },
      select: { id: true, name: true, type: true, category: true, isActive: true },
      orderBy: { name: "asc" },
    }),
    db.accessArea.findMany({
      where: { accountId: session.user.accountId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";

  return (
    <>
      <Header title="Monitore" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6 max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Erstelle und verwalte öffentliche Monitore für Scan-Ansichten, Check-ins, Ressourcen-Übersichten und Token-Scanner.
          </p>
          <Badge variant="secondary" className="ml-3 shrink-0 text-xs">
            {monitors.length} Monitor{monitors.length !== 1 ? "e" : ""}
          </Badge>
        </div>

        <MonitorManager
          monitors={monitors.map((m) => ({
            ...m,
            deviceIds: m.deviceIds as number[],
            createdAt: m.createdAt.toISOString(),
          }))}
          devices={devices}
          accessAreas={accessAreas}
          baseUrl={baseUrl}
        />
      </div>
    </>
  );
}
