import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { AreasCard } from "@/components/areas/areas-table";

interface AnnyExtra {
  mappings?: Record<string, number>;
  services?: string[];
  resources?: string[];
}

/** Gerätefunktionen mit Einlass/Auslass (wie im Gerätedialog). */
const ACCESS_CATEGORIES = new Set(["DREHKREUZ", "TUER"]);

export default async function AreasPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  const [areas, devices, annyConfig, annyLinks] = await Promise.all([
    db.accessArea.findMany({
      where: accountFilter,
      include: { _count: { select: { tickets: true } } },
      orderBy: { name: "asc" },
    }),
    db.device.findMany({
      where: accountFilter,
      select: { id: true, name: true, type: true, category: true, isActive: true, accessIn: true, accessOut: true },
      orderBy: { name: "asc" },
    }),
    db.apiConfig.findFirst({
      where: { ...accountFilter, provider: "ANNY" },
      select: { extraConfig: true },
    }).catch(() => null),
    db.annyResourceLink.findMany({
      where: accountFilter,
      select: { annyName: true, accessAreaId: true },
    }).catch(() => [] as { annyName: string; accessAreaId: number }[]),
  ]);

  const areaRows = areas.map(({ _count, ...area }) => ({
    ...area,
    ticketCount: _count.tickets,
    devicesIn: devices.filter((d) => d.accessIn === area.id).map((d) => ({ id: d.id, name: d.name })),
    devicesOut: devices.filter((d) => d.accessOut === area.id).map((d) => ({ id: d.id, name: d.name })),
  }));

  // Für den Reiter „Geräte“: Scanner (Pi), Drehkreuze und Türen – und alles,
  // was schon an einer Ressource hängt, damit es sich dort auch lösen lässt.
  const accessDevices = devices
    .filter((d) =>
      d.type === "RASPBERRY_PI"
      || (d.category != null && ACCESS_CATEGORIES.has(d.category))
      || d.accessIn != null
      || d.accessOut != null,
    )
    .map((d) => ({ id: d.id, name: d.name, isActive: d.isActive, accessIn: d.accessIn, accessOut: d.accessOut }));

  let annyResourceNames: string[] = [];
  let annyServiceNames: string[] = [];
  if (annyConfig?.extraConfig) {
    try {
      const parsed: AnnyExtra = JSON.parse(annyConfig.extraConfig);
      annyResourceNames = (parsed.resources || []).sort();
      const resSet = new Set(annyResourceNames);
      annyServiceNames = (parsed.services || []).filter((s) => !resSet.has(s)).sort();
    } catch { /* ignore */ }
  }

  const annyMappings: Record<string, number> = {};
  for (const link of annyLinks) {
    annyMappings[link.annyName] = link.accessAreaId;
  }

  return (
    <>
      <Header title="Ressourcen" accountName={session.user.accountName} />
      <div className="page-content">
        <AreasCard
          areas={areaRows}
          devices={isSuperAdmin ? [] : accessDevices}
          readonly={isSuperAdmin}
          annyResources={isSuperAdmin ? undefined : annyResourceNames}
          annyServices={isSuperAdmin ? undefined : annyServiceNames}
          annyMappings={isSuperAdmin ? undefined : annyMappings}
        />
      </div>
    </>
  );
}
