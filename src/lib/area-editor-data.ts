import type { PrismaClient } from "@prisma/client";

/**
 * Daten für den Dialog „Ressource bearbeiten“ (Reiter Geräte und anny) –
 * gemeinsam für die Liste `/areas` und die Detailseite `/areas/[id]`.
 */

/** Gerätefunktionen mit Einlass/Auslass (wie im Gerätedialog). */
const ACCESS_CATEGORIES = new Set(["DREHKREUZ", "TUER"]);

interface AnnyExtra {
  services?: string[];
  resources?: string[];
}

export interface EditorDevice {
  id: number;
  name: string;
  type: string;
  category: string | null;
  isActive: boolean;
  lastUpdate: Date | null;
  accessIn: number | null;
  accessOut: number | null;
}

export async function loadAreaEditorData(db: PrismaClient, accountFilter: { accountId?: number }) {
  const [devices, annyConfig, annyLinks] = await Promise.all([
    db.device.findMany({
      where: accountFilter,
      select: {
        id: true, name: true, type: true, category: true, isActive: true, lastUpdate: true,
        accessIn: true, accessOut: true,
      },
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

  let annyResources: string[] = [];
  let annyServices: string[] = [];
  if (annyConfig?.extraConfig) {
    try {
      const parsed: AnnyExtra = JSON.parse(annyConfig.extraConfig);
      annyResources = (parsed.resources || []).sort();
      const resSet = new Set(annyResources);
      annyServices = (parsed.services || []).filter((s) => !resSet.has(s)).sort();
    } catch { /* ignore */ }
  }

  const annyMappings: Record<string, number> = {};
  for (const link of annyLinks) annyMappings[link.annyName] = link.accessAreaId;

  return { devices: devices as EditorDevice[], accessDevices, annyResources, annyServices, annyMappings };
}
