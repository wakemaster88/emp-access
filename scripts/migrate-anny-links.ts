/**
 * Migration script: extraConfig.mappings + resourceIds -> AnnyResourceLink table.
 *
 * Run once:  npx tsx scripts/migrate-anny-links.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

interface AnnyMapping {
  mappings?: Record<string, number>;
  resourceIds?: Record<string, string>;
  services?: string[];
  resources?: string[];
}

interface ServiceInfo {
  interval: number;
  price: string;
}

function cleanLabel(name: string): string {
  let l = name.replace(/^Wake & Ski\s*-\s*/i, "").trim();
  if (l.includes(" - ")) l = l.split(" - ")[0].trim();
  return l;
}

function cleanLabelForMatch(name: string): string {
  let l = name.replace(/^Wake & Ski\s*-\s*/i, "").trim();
  if (l.includes(" - ")) l = l.split(" - ")[0].trim();
  return l.toLowerCase();
}

async function fetchAllServices(
  baseUrl: string,
  token: string,
): Promise<Map<string, ServiceInfo>> {
  const result = new Map<string, ServiceInfo>();
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `${baseUrl}/api/v1/services?page[size]=50&page[number]=${page}`,
      { headers, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) break;
    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (json.data || json) as any[];
    if (!Array.isArray(items) || items.length === 0) break;

    for (const svc of items) {
      const a = svc.attributes || svc;
      const name = a.name as string;
      if (!name) continue;
      const interval = (a.booking_interval as number) || (a.min_duration as number) || 0;
      const price = (a.price_label as string) || (a.price != null ? `${a.price}€` : "");
      if (interval > 0) {
        const existing = result.get(name);
        if (!existing || interval < existing.interval) {
          result.set(name, { interval, price });
        }
      }
    }
    if (items.length < 50) break;
  }

  return result;
}

async function main() {
  const configs = await prisma.apiConfig.findMany({
    where: { provider: "ANNY" },
    select: { id: true, accountId: true, token: true, baseUrl: true, extraConfig: true },
  });

  for (const config of configs) {
    if (!config.extraConfig) continue;
    let parsed: AnnyMapping;
    try {
      parsed = JSON.parse(config.extraConfig);
    } catch {
      continue;
    }

    const mappings = parsed.mappings ?? {};
    const resourceIds = parsed.resourceIds ?? {};
    const baseUrl = (config.baseUrl || "https://b.anny.co").replace(/\/+$/, "");

    console.log(`\nAccount ${config.accountId}: ${Object.keys(mappings).length} mappings`);

    const services = await fetchAllServices(baseUrl, config.token);
    console.log(`  Fetched ${services.size} services from ANNY`);

    // Build rid -> ServiceInfo via exact name match + fuzzy
    const ridService = new Map<string, ServiceInfo>();
    for (const [name, rid] of Object.entries(resourceIds)) {
      if (ridService.has(rid)) continue;
      const svc = services.get(name);
      if (svc) ridService.set(rid, svc);
    }
    for (const [name, rid] of Object.entries(resourceIds)) {
      if (ridService.has(rid)) continue;
      const cleaned = cleanLabelForMatch(name);
      if (!cleaned) continue;
      for (const [svcName, svcInfo] of services) {
        const cleanedSvc = cleanLabelForMatch(svcName);
        if (
          cleaned === cleanedSvc ||
          cleaned.startsWith(cleanedSvc) ||
          cleanedSvc.startsWith(cleaned)
        ) {
          ridService.set(rid, svcInfo);
          break;
        }
      }
    }

    // Collect all prices per rid for public resources
    const ridAllPrices = new Map<string, string[]>();
    for (const [name, rid] of Object.entries(resourceIds)) {
      if (!/öffentlich/i.test(name)) continue;
      for (const [svcName, svcInfo] of services) {
        if (/öffentlich/i.test(svcName) && svcInfo.price) {
          if (!ridAllPrices.has(rid)) ridAllPrices.set(rid, []);
          const list = ridAllPrices.get(rid)!;
          if (!list.includes(svcInfo.price)) list.push(svcInfo.price);
        }
      }
    }

    let created = 0;
    let skipped = 0;

    for (const [name, areaId] of Object.entries(mappings)) {
      const rid = resourceIds[name];
      if (!rid) {
        console.log(`  SKIP (no rid): ${name}`);
        skipped++;
        continue;
      }

      const label = cleanLabel(name);
      const isPublic = /öffentlich/i.test(name);
      const svcInfo = ridService.get(rid);
      const splitSlots = !isPublic && (svcInfo?.interval ?? 0) > 0;

      let priceLabel: string | null = null;
      if (isPublic) {
        const allPrices = ridAllPrices.get(rid);
        priceLabel = allPrices ? allPrices.join(", ") : svcInfo?.price || null;
      } else {
        priceLabel = svcInfo?.price || null;
      }

      try {
        await prisma.annyResourceLink.upsert({
          where: {
            accessAreaId_annyName: { accessAreaId: areaId, annyName: name },
          },
          update: {
            annyResourceId: rid,
            label,
            isPublic,
            splitSlots,
            bookingInterval: svcInfo?.interval || null,
            priceLabel,
          },
          create: {
            accessAreaId: areaId,
            annyResourceId: rid,
            annyName: name,
            label,
            isPublic,
            splitSlots,
            bookingInterval: svcInfo?.interval || null,
            priceLabel,
            accountId: config.accountId,
          },
        });
        created++;
      } catch (e) {
        console.log(`  ERROR: ${name} -> area ${areaId}: ${e}`);
      }
    }

    console.log(`  Created/updated: ${created}, Skipped: ${skipped}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
