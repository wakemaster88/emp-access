import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreasTable } from "@/components/areas/areas-table";

export default async function AreasPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  const [areas, devices] = await Promise.all([
    db.accessArea.findMany({
      where: accountFilter,
      include: {
        parent: true,
        _count: { select: { tickets: true, children: true } },
      },
      orderBy: [{ parentId: "asc" }, { name: "asc" }],
    }),
    db.device.findMany({
      where: accountFilter,
      select: { id: true, name: true, accessIn: true, accessOut: true },
    }),
  ]);

  // Map devices to areas
  const areaRows = areas.map((area) => ({
    ...area,
    devicesIn: devices.filter((d) => d.accessIn === area.id).map((d) => ({ id: d.id, name: d.name })),
    devicesOut: devices.filter((d) => d.accessOut === area.id).map((d) => ({ id: d.id, name: d.name })),
  }));

  return (
    <>
      <Header title="Zugangsbereiche" accountName={session.user.accountName} />
      <div className="p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader>
            <CardTitle>Alle Bereiche ({areas.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <AreasTable areas={areaRows as never} readonly={isSuperAdmin} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
