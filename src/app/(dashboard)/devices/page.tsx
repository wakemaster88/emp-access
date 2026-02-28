import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddDeviceDialog } from "@/components/devices/add-device-dialog";
import { DevicesTable } from "@/components/devices/devices-table";
import { DeviceStatusFilter, type DeviceStatusFilterValue } from "@/components/devices/device-status-filter";

interface Props {
  searchParams: Promise<{ status?: string }>;
}

export default async function DevicesPage({ searchParams }: Props) {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const { status: statusParam } = await searchParams;
  const status: DeviceStatusFilterValue =
    statusParam === "inactive" || statusParam === "all" ? statusParam : "active";

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);

  const baseWhere = isSuperAdmin ? {} : { accountId: session.user.accountId! };
  const statusWhere =
    status === "active" ? { isActive: true } : status === "inactive" ? { isActive: false } : {};

  const [devices, areas] = await Promise.all([
    db.device.findMany({
      where: { ...baseWhere, ...statusWhere },
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
      <div className="p-4 sm:p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 pb-4">
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="text-base sm:text-xl">Geräte ({devices.length})</CardTitle>
              <DeviceStatusFilter current={status} />
            </div>
            {!isSuperAdmin && <AddDeviceDialog areas={areas} />}
          </CardHeader>
          <CardContent className="p-0 sm:px-6 sm:pb-6">
            <DevicesTable devices={devices} areas={areas} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
