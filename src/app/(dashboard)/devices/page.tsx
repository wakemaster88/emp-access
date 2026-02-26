import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddDeviceDialog } from "@/components/devices/add-device-dialog";
import { DevicesTable } from "@/components/devices/devices-table";

export default async function DevicesPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);

  const [devices, areas] = await Promise.all([
    db.device.findMany({
      where: isSuperAdmin ? {} : { accountId: session.user.accountId! },
      select: {
        id: true,
        name: true,
        type: true,
        category: true,
        ipAddress: true,
        isActive: true,
        task: true,
        accessIn: true,
        accessOut: true,
        lastUpdate: true,
        _count: { select: { scans: true } },
      },
      orderBy: { name: "asc" },
    }),
    isSuperAdmin ? Promise.resolve([]) : db.accessArea.findMany({
      where: { accountId: session.user.accountId! },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <Header title="Geräte" accountName={session.user.accountName} />
      <div className="p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle>Alle Geräte ({devices.length})</CardTitle>
            {!isSuperAdmin && <AddDeviceDialog areas={areas} />}
          </CardHeader>
          <CardContent className="p-0">
            <DevicesTable devices={devices} areas={areas} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
