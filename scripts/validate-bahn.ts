import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import {
  resolveAnnyOrganizationId,
  fetchAllAnnyServices,
  matchAllAnnyServicesInCatalog,
  fetchAnnyServiceStartSlots,
  resolveServiceResourceId,
} from "../src/lib/anny-availability";
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

function collectServiceNames(empName: string, annyNamesJson: string | null): string[] {
  const names: string[] = [];
  if (annyNamesJson) { try { const p = JSON.parse(annyNamesJson); if (Array.isArray(p)) for (const n of p) if (typeof n === "string" && n.trim()) names.push(n.trim()); } catch {} }
  if (empName) { names.push(empName); const parts = empName.split(/\s[-–]\s/); if (parts.length > 1) for (const p of parts) if (p.trim()) names.push(p.trim()); }
  return Array.from(new Set(names));
}

async function main() {
  const cfg = await prisma.apiConfig.findFirst({ where: { provider: "ANNY" } });
  const accountId = cfg!.accountId;
  const baseUrl = (cfg!.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
  const org = await resolveAnnyOrganizationId(baseUrl, cfg!.token, cfg!.extraConfig);
  const catalog = await fetchAllAnnyServices(baseUrl, cfg!.token, org);
  const date = process.argv[2] ?? new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

  console.log("=== (1) MONITOR: Slot-Overview Resource-Trennung ===");
  const svcs = await prisma.service.findMany({
    where: { accountId, name: { in: ["Exklusive Bahnmiete A", "Exklusive Bahnmiete B"] } },
    select: { id: true, name: true, annyNames: true,
      serviceAreas: { select: { area: { select: { annyLinks: { select: { annyResourceId: true } } } } } } },
  });
  for (const svc of svcs) {
    const names = collectServiceNames(svc.name, svc.annyNames);
    const matches = matchAllAnnyServicesInCatalog(catalog, names);
    const linked = svc.serviceAreas.flatMap((sa) => sa.area?.annyLinks ?? []).map((l) => l.annyResourceId).filter((x): x is string => !!x);
    const target = resolveServiceResourceId(linked, matches.flatMap((m) => m.resourceIds));
    const slots = matches.length > 0 ? await fetchAnnyServiceStartSlots(baseUrl, cfg!.token, matches[0].id, date, { organizationId: org, resourceId: target ?? undefined, slotDurationMinutes: 60 }) : [];
    console.log(`\n  #${svc.id} "${svc.name}": matches=${matches.length} targetResource=${target}`);
    console.log(`     Slots(${slots.length}): ${slots.map((s) => `${s.startTime}[${(s.resourceIds ?? []).join("/")}]`).join(" ")}`);
  }

  console.log("\n=== (2) SYNC: Service/Area-Zuordnung A vs B ===");
  // svcNameMap + ambiguous nachbilden
  const all = await prisma.service.findMany({ where: { accountId }, select: { id: true, annyNames: true } });
  const svcNameMap = new Map<string, number>();
  const ambiguous = new Set<string>();
  for (const s of all) { if (!s.annyNames) continue; try { for (const n of JSON.parse(s.annyNames) as string[]) { if (svcNameMap.has(n) && svcNameMap.get(n) !== s.id) ambiguous.add(n); svcNameMap.set(n, s.id); } } catch {} }
  const links = await prisma.annyResourceLink.findMany({ where: { accountId }, select: { annyName: true, accessAreaId: true } });
  const areaMap: Record<string, number> = {}; for (const l of links) areaMap[l.annyName] = l.accessAreaId;

  const resolve = (serviceName: string, resourceName: string) => {
    const byS = svcNameMap.get(serviceName); const byR = svcNameMap.get(resourceName);
    let serviceId: number | null = null;
    if (ambiguous.has(serviceName) && byR != null) serviceId = byR; else if (byS != null) serviceId = byS; else if (byR != null) serviceId = byR;
    const aS = areaMap[serviceName] ?? null; const aR = areaMap[resourceName] ?? null;
    let area: number | null = null;
    if (ambiguous.has(serviceName) && aR != null) area = aR; else if (aS != null) area = aS; else if (aR != null) area = aR;
    return { serviceId, area };
  };

  for (const [svcName, resName, expect] of [
    ["Exklusive Bahnmiete - Wochentag", "Wake & Ski - Exklusive Bahnmieten A", "A(13)/area5"],
    ["Exklusive Bahnmiete - Wochentag", "Wake & Ski - Exklusive Bahnmieten B", "B(7)/area6"],
    ["Exklusive Bahnmiete - Wochenende", "Wake & Ski - Exklusive Bahnmieten B", "B(7)/area6"],
  ] as const) {
    const r = resolve(svcName, resName);
    console.log(`  ambiguous(${svcName})=${ambiguous.has(svcName)} | res="${resName}" -> serviceId=${r.serviceId} area=${r.area}  (erwartet ${expect})`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
