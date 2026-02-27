import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreasTable } from "@/components/areas/areas-table";

interface AnnyExtra {
  mappings?: Record<string, number>;
  services?: string[];
  resources?: string[];
}

export default async function AreasPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  const [areas, devices, annyConfig] = await Promise.all([
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
    db.apiConfig.findFirst({
      where: { ...accountFilter, provider: "ANNY" },
      select: { extraConfig: true },
    }).catch(() => null),
  ]);

  // Map devices to areas
  const areaRows = areas.map((area) => ({
    ...area,
    devicesIn: devices.filter((d) => d.accessIn === area.id).map((d) => ({ id: d.id, name: d.name })),
    devicesOut: devices.filter((d) => d.accessOut === area.id).map((d) => ({ id: d.id, name: d.name })),
  }));

  let annyResourceNames: string[] = [];
  let annyServiceNames: string[] = [];
  let annyMappings: Record<string, number> = {};
  if (annyConfig?.extraConfig) {
    try {
      const parsed: AnnyExtra = JSON.parse(annyConfig.extraConfig);
      annyResourceNames = (parsed.resources || []).sort();
      const resSet = new Set(annyResourceNames);
      annyServiceNames = (parsed.services || []).filter((s) => !resSet.has(s)).sort();
      annyMappings = parsed.mappings || {};
    } catch { /* ignore */ }
  }

  return (
    <>
      <Header title="Resourcen" accountName={session.user.accountName} />
      <div className="p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Alle Resourcen ({areas.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <AreasTable
              areas={areaRows as never}
              readonly={isSuperAdmin}
              annyResources={isSuperAdmin ? undefined : annyResourceNames}
              annyServices={isSuperAdmin ? undefined : annyServiceNames}
              annyMappings={isSuperAdmin ? undefined : annyMappings}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
