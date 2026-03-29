/**
 * Migration script: updates AnnyResourceLink priceLabel + priceLabelWeekend
 * from live ANNY service data.
 *
 * Run:  npx tsx scripts/migrate-anny-links.ts
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

interface AnnyService {
  name: string;
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

async function fetchAllAnnyServices(
  baseUrl: string,
  token: string,
): Promise<AnnyService[]> {
  const result: AnnyService[] = [];
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  for (let page = 1; page <= 10; page++) {
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
      result.push({ name, interval, price });
    }
    if (items.length < 50) break;
  }

  return result;
}

const WEEKEND_KEYWORDS = ["wochenende", "weekend", "sa/so", "sa-so", "samstag", "sonntag"];

function isWeekendVariant(name: string): boolean {
  const lower = name.toLowerCase();
  return WEEKEND_KEYWORDS.some((kw) => lower.includes(kw));
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

    const allServices = await fetchAllAnnyServices(baseUrl, config.token);
    console.log(`  Fetched ${allServices.length} services from ANNY`);

    // Build rid -> best ServiceInfo (smallest interval) for non-public matching
    const ridService = new Map<string, AnnyService>();
    for (const [name, rid] of Object.entries(resourceIds)) {
      const cleaned = cleanLabelForMatch(name);
      for (const svc of allServices) {
        if (isWeekendVariant(svc.name)) continue;
        const cleanedSvc = cleanLabelForMatch(svc.name);
        if (cleanedSvc === cleaned || cleanedSvc.startsWith(cleaned) || cleaned.startsWith(cleanedSvc)) {
          const existing = ridService.get(rid);
          if (!existing || (svc.interval > 0 && svc.interval < existing.interval)) {
            ridService.set(rid, svc);
          }
        }
      }
    }

    // Collect ÖB prices: ONLY services with "öffentlich" in the name
    const publicPricesWeekday: string[] = [];
    const publicPricesWeekend: string[] = [];
    for (const svc of allServices) {
      if (!svc.price) continue;
      const lower = svc.name.toLowerCase();
      if (!lower.includes("öffentlich")) continue;
      if (isWeekendVariant(svc.name)) {
        if (!publicPricesWeekend.includes(svc.price)) publicPricesWeekend.push(svc.price);
      } else {
        if (!publicPricesWeekday.includes(svc.price)) publicPricesWeekday.push(svc.price);
      }
    }

    // Detect weekend price variants for non-public services
    const weekendPriceByBase = new Map<string, string>();
    for (const svc of allServices) {
      if (!svc.price || !isWeekendVariant(svc.name)) continue;
      if (svc.name.toLowerCase().includes("öffentlich")) continue;
      const base = cleanLabelForMatch(svc.name);
      const existing = weekendPriceByBase.get(base);
      if (!existing || svc.price.length > existing.length) {
        weekendPriceByBase.set(base, svc.price);
      }
    }

    console.log(`  ÖB prices weekday: ${publicPricesWeekday.join(" | ") || "(keine)"}`);
    console.log(`  ÖB prices weekend: ${publicPricesWeekend.join(" | ") || "(keine)"}`);
    console.log(`  Weekend variants: ${weekendPriceByBase.size}`);
    for (const [base, price] of weekendPriceByBase) {
      console.log(`    "${base}" → ${price}`);
    }

    let updated = 0;
    let skipped = 0;

    for (const [name, areaId] of Object.entries(mappings)) {
      const rid = resourceIds[name];
      if (!rid) { skipped++; continue; }

      const label = cleanLabel(name);
      const isPublic = /öffentlich/i.test(name);
      const svcInfo = ridService.get(rid);
      const splitSlots = !isPublic && (svcInfo?.interval ?? 0) > 0;

      let priceLabel: string | null = null;
      let priceLabelWeekend: string | null = null;

      if (isPublic) {
        priceLabel = publicPricesWeekday.length > 0
          ? publicPricesWeekday.join("\n")
          : svcInfo?.price || null;
        priceLabelWeekend = publicPricesWeekend.length > 0
          ? publicPricesWeekend.join("\n")
          : null;
      } else {
        priceLabel = svcInfo?.price || null;
        const cleanedLink = cleanLabelForMatch(name);
        for (const [base, price] of weekendPriceByBase) {
          if (cleanedLink.startsWith(base) || base.startsWith(cleanedLink)) {
            priceLabelWeekend = price;
            break;
          }
        }
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
            priceLabelWeekend,
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
            priceLabelWeekend,
            accountId: config.accountId,
          },
        });
        const weekendInfo = priceLabelWeekend ? ` | WE: ${priceLabelWeekend}` : "";
        console.log(`  ✓ ${label} → ${priceLabel || "(null)"}${weekendInfo}`);
        updated++;
      } catch (e) {
        console.log(`  ERROR: ${name} -> area ${areaId}: ${e}`);
      }
    }

    console.log(`\n  Updated: ${updated}, Skipped: ${skipped}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
