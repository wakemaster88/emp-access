/**
 * Diagnose: Anfaengerkurse "Uebungslift" und "Seilbahn B" teilen sich die
 * Kapazitaet, obwohl sie zwei unabhaengige physische Ressourcen sind.
 *
 * Ursache (ANNY-seitig): beide ANNY-Services haengen an DERSELBEN Resource
 * "Wake & Ski - Anfaengerkurse" (179477, quantity=15). ANNY zaehlt Buchungen
 * pro Resource, nicht pro Service - jede Buchung auf einem Kurs senkt daher
 * `number_available` bei BEIDEN Kursen.
 *
 * Das Skript belegt das, indem es fuer mehrere Tage `quota` vs
 * `number_available` beider Services gegenueberstellt und mit den EMP-Tickets
 * abgleicht: die "belegt"-Zahl ist bei beiden Services identisch und
 * entspricht der Summe der Buchungen ueber BEIDE Kurse.
 *
 * Aufruf: npx tsx --env-file=.env.local scripts/diagnose-anfaengerkurs-kapazitaet.ts [tage]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import {
  resolveAnnyOrganizationId,
  fetchAllAnnyServices,
  matchAllAnnyServicesInCatalog,
  resolveServiceResourceId,
} from "../src/lib/anny-availability";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

/** Rohform eines Slots aus GET /api/v1/availability/start. */
interface RawSlot {
  start_date: string;
  available: boolean;
  number_available: number | null;
  quota: number | null;
  unavailability_type: string | null;
  resource_ids: string[];
}

function collectServiceNames(empName: string, annyNamesJson: string | null): string[] {
  const names: string[] = [];
  if (annyNamesJson) {
    try {
      const p = JSON.parse(annyNamesJson);
      if (Array.isArray(p)) for (const n of p) if (typeof n === "string" && n.trim()) names.push(n.trim());
    } catch { /* ignore */ }
  }
  if (empName) {
    names.push(empName);
    const parts = empName.split(/\s[-–]\s/);
    if (parts.length > 1) for (const p of parts) if (p.trim()) names.push(p.trim());
  }
  return Array.from(new Set(names));
}

async function main() {
  const cfg = await prisma.apiConfig.findFirst({ where: { provider: "ANNY" } });
  if (!cfg) throw new Error("Keine ANNY-ApiConfig gefunden");
  const accountId = cfg.accountId;
  const baseUrl = (cfg.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
  const org = await resolveAnnyOrganizationId(baseUrl, cfg.token, cfg.extraConfig);
  const H = { Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.api+json" };
  const catalog = await fetchAllAnnyServices(baseUrl, cfg.token, org);

  // --- 1. EMP-Services + aufgeloeste ANNY-Resource ---
  const svcs = await prisma.service.findMany({
    where: { accountId, name: { contains: "nf", mode: "insensitive" } },
    select: {
      id: true, name: true, annyNames: true, mainAccessAreaId: true,
      serviceAreas: {
        select: {
          area: {
            select: { id: true, name: true, annyLinks: { select: { annyResourceId: true, annyName: true } } },
          },
        },
      },
    },
  });
  const kurse = svcs.filter((s) => /anf(ä|ae)ngerkurs/i.test(s.name));

  console.log("=== 1. EMP-Service -> ANNY-Service -> ANNY-Resource ===");
  const annyServiceIds: Array<{ empId: number; empName: string; annyId: string; label: string }> = [];
  for (const svc of kurse) {
    const names = collectServiceNames(svc.name, svc.annyNames);
    const matches = matchAllAnnyServicesInCatalog(catalog, names);
    const linked = svc.serviceAreas
      .flatMap((sa) => sa.area?.annyLinks ?? [])
      .map((l) => l.annyResourceId)
      .filter((x): x is string => !!x);
    const target = resolveServiceResourceId(linked, matches.flatMap((m) => m.resourceIds ?? []));
    console.log(`\n  EMP #${svc.id} "${svc.name}" (mainArea=${svc.mainAccessAreaId})`);
    for (const m of matches) {
      console.log(`    -> ANNY-Service "${m.name}" (${m.id}) haengt an Resource(s) [${(m.resourceIds ?? []).join(", ")}]`);
      annyServiceIds.push({ empId: svc.id, empName: svc.name, annyId: m.id, label: svc.name });
    }
    console.log(`    -> targetResourceId (EMP-Filter) = ${target}`);
  }

  // --- 2. Resource-Kapazitaeten ---
  const resourceIds = Array.from(new Set(
    kurse.flatMap((s) => s.serviceAreas.flatMap((sa) => sa.area?.annyLinks ?? []).map((l) => l.annyResourceId)),
  )).filter((x): x is string => !!x);
  console.log("\n=== 2. ANNY-Resource-Kapazitaeten (quantity = Pool-Groesse) ===");
  for (const rid of resourceIds) {
    const r = await fetch(`${baseUrl}/api/v1/resources/${rid}?o=${org}`, { headers: H });
    if (!r.ok) { console.log(`  ${rid}: HTTP ${r.status}`); continue; }
    const j = await r.json() as { data?: { attributes?: Record<string, unknown> } };
    const a = j.data?.attributes ?? {};
    console.log(`  ${rid} "${a.name}": quantity=${a.quantity} max_booking_quantity=${a.max_booking_quantity}`);
  }

  // --- 3. Beweis: quota vs number_available ueber mehrere Tage ---
  const days = Number(process.argv[2] ?? 8);
  const base = new Date();
  console.log(`\n=== 3. quota vs number_available (${days} Tage) ===`);
  console.log("    Identische 'belegt'-Zahl bei beiden Kursen => geteilter Pool.\n");
  for (let d = 0; d < days; d++) {
    const date = new Date(base.getTime() + d * 86400000)
      .toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
    const perSvc = new Map<string, Map<string, RawSlot>>();
    for (const s of annyServiceIds) {
      const u = `${baseUrl}/api/v1/availability/start?`
        + new URLSearchParams({ o: String(org), service_id: s.annyId, date });
      const r = await fetch(u, { headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" } });
      const arr = (await r.json()) as RawSlot[];
      const m = new Map<string, RawSlot>();
      for (const it of Array.isArray(arr) ? arr : []) m.set(it.start_date.slice(11, 16), it);
      perSvc.set(s.annyId, m);
    }
    const times = Array.from(new Set([...perSvc.values()].flatMap((m) => [...m.keys()]))).sort();
    if (times.length === 0) { console.log(`  ${date}: keine Slots`); continue; }
    console.log(`  --- ${date} ---`);
    for (const t of times) {
      const parts = annyServiceIds.map((s) => {
        const it = perSvc.get(s.annyId)!.get(t);
        if (!it) return `${s.label}: -`;
        const used = it.quota != null && it.number_available != null ? it.quota - it.number_available : null;
        return `${s.label}: frei=${it.number_available}/${it.quota} belegt=${used ?? "?"} (${it.unavailability_type ?? "ok"})`;
      });
      console.log(`    ${t}  ${parts.join("  |  ")}`);
    }
  }

  // --- 4. EMP-Tickets zum Abgleich ---
  console.log("\n=== 4. EMP-Tickets (VALID/REDEEMED) zum Abgleich ===");
  const tickets = await prisma.ticket.findMany({
    where: {
      accountId,
      status: { in: ["VALID", "REDEEMED"] },
      serviceId: { in: kurse.map((s) => s.id) },
      startDate: { gte: new Date(new Date().toDateString()) },
    },
    select: { serviceId: true, slotStart: true, startDate: true },
  });
  const agg = new Map<string, number>();
  for (const t of tickets) {
    const day = t.startDate?.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }) ?? "?";
    const svcName = kurse.find((s) => s.id === t.serviceId)?.name ?? `#${t.serviceId}`;
    agg.set(`${day} ${t.slotStart ?? "(kein Slot)"} - ${svcName}`, (agg.get(`${day} ${t.slotStart ?? "(kein Slot)"} - ${svcName}`) ?? 0) + 1);
  }
  for (const [k, v] of [...agg.entries()].sort()) console.log(`  ${k}: ${v}`);

  // --- 5. Slot-Sperren (blocken die ganze Resource -> beide Kurse) ---
  console.log("\n=== 5. Aktive EMP-Slot-Sperren (Blocker gilt fuer die ganze Resource) ===");
  const blocks = await prisma.slotBlock.findMany({
    where: { accountId, serviceId: { in: kurse.map((s) => s.id) } },
    select: { id: true, serviceId: true, serviceName: true, date: true, slotStart: true, slotEnd: true, quantity: true },
    orderBy: { date: "asc" },
  });
  for (const b of blocks) {
    console.log(`  block#${b.id} "${b.serviceName}" ${b.date} ${b.slotStart}-${b.slotEnd} qty=${b.quantity}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
