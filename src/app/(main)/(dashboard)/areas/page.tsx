import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { AreasCard } from "@/components/areas/areas-table";
import { loadAreaEditorData } from "@/lib/area-editor-data";

export default async function AreasPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  const [areas, editor] = await Promise.all([
    db.accessArea.findMany({
      where: accountFilter,
      include: { _count: { select: { tickets: true } } },
      orderBy: { name: "asc" },
    }),
    loadAreaEditorData(db, accountFilter),
  ]);

  const areaRows = areas.map(({ _count, ...area }) => ({
    ...area,
    ticketCount: _count.tickets,
    devicesIn: editor.devices.filter((d) => d.accessIn === area.id).map((d) => ({ id: d.id, name: d.name })),
    devicesOut: editor.devices.filter((d) => d.accessOut === area.id).map((d) => ({ id: d.id, name: d.name })),
  }));

  return (
    <>
      <Header title="Ressourcen" accountName={session.user.accountName} />
      <div className="page-content">
        <AreasCard
          areas={areaRows}
          devices={isSuperAdmin ? [] : editor.accessDevices}
          readonly={isSuperAdmin}
          annyResources={isSuperAdmin ? undefined : editor.annyResources}
          annyServices={isSuperAdmin ? undefined : editor.annyServices}
          annyMappings={isSuperAdmin ? undefined : editor.annyMappings}
          unassignedTicketsOption={!isSuperAdmin && editor.ticketNeedsArea}
        />
      </div>
    </>
  );
}
