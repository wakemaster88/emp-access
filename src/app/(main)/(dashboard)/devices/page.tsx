import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  const [devices, areas, rooms] = await Promise.all([
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
        systemInfo: true,
        _count: { select: { scans: true } },
      },
      orderBy: { name: "asc" },
    }),
    isSuperAdmin ? Promise.resolve([]) : db.accessArea.findMany({
      where: { accountId: session.user.accountId! },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    isSuperAdmin ? Promise.resolve([]) : db.keyRoom.findMany({
      where: { accountId: session.user.accountId! },
      select: { id: true, name: true },
      orderBy: [{ building: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <>
      <Header title="Geräte" accountName={session.user.accountName} />
      <div className="page-content space-y-4 sm:space-y-5">
        {/* Tabelle läuft bis an den Kartenrand (docs/design-regeln.md, Abschnitt 17). */}
        <Card flush>
          {/* Kopf: Titel links, „Gerät hinzufügen“ oben rechts (docs/design-regeln.md, Abschnitt 13).
              Ab sm steht der Statusfilter neben dem Titel. Auf dem Handy löst sich die Hülle auf
              (contents): der Titel steht neben der Taste, der Filter in voller Breite darunter. */}
          <CardHeader>
            <div className="contents sm:flex sm:flex-wrap sm:items-center sm:gap-3">
              <CardTitle className="tabular-nums">Geräte ({devices.length})</CardTitle>
              <div className="max-sm:col-span-full max-sm:mt-1.5">
                <DeviceStatusFilter current={status} />
              </div>
            </div>
            {!isSuperAdmin && (
              <CardAction>
                <AddDeviceDialog areas={areas} rooms={rooms} />
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
            <DevicesTable devices={devices} areas={areas} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
