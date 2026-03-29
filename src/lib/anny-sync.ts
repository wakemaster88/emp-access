import { prisma } from "@/lib/prisma";
import { extractAnnyBookingScanCode } from "@/lib/anny-booking-scan-code";
import { normalizeAnnyBookingsResponse } from "@/lib/anny-jsonapi";
import type { AnnyBooking } from "@/lib/anny-types";

const DEFAULT_BASE_URL = "https://b.anny.co";
const SYNC_WINDOW_DAYS = 60;

interface BookingEntry {
  id: string;
  start: string | null;
  end: string | null;
  status: string | null;
}

interface TicketExtra {
  name: string;
  quantity: number;
}

interface BookingGroup {
  key: string;
  entries: BookingEntry[];
  bookingNumber: string | null;
  scanCode: string | null;
  customerName: string;
  firstName: string;
  lastName: string;
  birthDate: Date | null;
  serviceName: string | null;
  resourceName: string | null;
  subscriptionName: string | null;
  startDate: Date | null;
  endDate: Date | null;
  statuses: string[];
  extras: TicketExtra[];
}

interface AnnyMapping {
  mappings?: Record<string, number>;
  services?: string[];
  resources?: string[];
  subscriptions?: string[];
  resourceIds?: Record<string, string>;
}

interface PlanSubscription {
  id?: string;
  name?: string;
  status?: string;
  starts_at?: string;
  ends_at?: string;
  contract_ends_at?: string;
  minimum_contract_months?: number;
  minimum_contract_period?: number;
  plan?: {
    id?: string;
    name?: string;
    title?: string;
    interval?: string;
    interval_count?: number;
    minimum_contract_months?: number;
    minimum_contract_period?: number;
    duration_months?: number;
  };
  customer?: {
    id?: string | number;
    full_name?: string;
    given_name?: string;
    family_name?: string;
    birth_date?: string;
  };
}

export interface AnnySyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  errorDetails?: string[];
  invalidated: number;
  total: number;
  oldSkipped: number;
  syncWindowDays: number;
  pages: number;
  groups: number;
  resources: number;
  services: number;
  subscriptions: number;
  planSubscriptions: number;
  planSubscriptionsCreated: number;
  planSubscriptionsUpdated: number;
  unmapped: { annyName: string; count: number; customerSample: string[] }[];
}

function extractExtras(booking: AnnyBooking): TicketExtra[] {
  const items = booking.line_items ?? booking.products ?? booking.extras ?? [];
  const result: TicketExtra[] = [];
  for (const item of items) {
    const name = item.name ?? item.title ?? item.product?.name ?? item.product?.title;
    if (name) result.push({ name, quantity: item.quantity ?? 1 });
  }
  return result;
}

function mapGroupStatus(statuses: string[]): "VALID" | "INVALID" | "REDEEMED" {
  if (statuses.length === 0) return "VALID";
  const normalized = statuses.map((s) => s.toLowerCase());
  const allCancelled = normalized.every((s) =>
    s === "cancelled" || s === "canceled" || s === "rejected" || s === "no_show"
  );
  if (allCancelled) return "INVALID";
  const allDone = normalized.every((s) =>
    s === "checked_out" || s === "completed" || s === "cancelled" || s === "canceled"
  );
  if (allDone) return "REDEEMED";
  return "VALID";
}

function parseDurationMonthsFromName(name: string | null): number | null {
  if (!name) return null;
  const match = name.match(/(\d+)\s*M(?:\b|$)/i);
  if (match) return parseInt(match[1], 10);
  const yearMatch = name.match(/(\d+)\s*(?:Jahr|year)/i);
  if (yearMatch) return parseInt(yearMatch[1], 10) * 12;
  return null;
}

function calcSubscriptionEndDate(
  ps: PlanSubscription,
  startDate: Date | null,
  planName: string | null,
  subscriptionId: number | null,
  subDefaultEndDate: Map<number, Date | null>,
): Date | null {
  if (ps.contract_ends_at) return new Date(ps.contract_ends_at);

  const contractMonths =
    ps.minimum_contract_months ??
    ps.minimum_contract_period ??
    ps.plan?.minimum_contract_months ??
    ps.plan?.minimum_contract_period ??
    ps.plan?.duration_months ??
    null;

  if (contractMonths && startDate) {
    const end = new Date(startDate);
    end.setMonth(end.getMonth() + contractMonths);
    return end;
  }

  const nameMonths = parseDurationMonthsFromName(planName) ?? parseDurationMonthsFromName(ps.plan?.name ?? ps.plan?.title ?? null);
  if (nameMonths && startDate) {
    const end = new Date(startDate);
    end.setMonth(end.getMonth() + nameMonths);
    return end;
  }

  if (subscriptionId != null) {
    const defEnd = subDefaultEndDate.get(subscriptionId);
    if (defEnd) return defEnd;
  }

  if (ps.ends_at) return new Date(ps.ends_at);
  return null;
}

async function createTicketSafe(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ticketData: any,
  uuid: string,
  accountId: number,
) {
  try {
    return await prisma.ticket.create({ data: { ...ticketData, uuid, accountId } });
  } catch (e: unknown) {
    const isPrismaUnique =
      e != null &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code: string }).code === "P2002";
    if (isPrismaUnique) {
      console.warn(`[anny sync] barcode conflict uuid=${uuid}, retrying without barcode`);
      return await prisma.ticket.create({ data: { ...ticketData, barcode: null, uuid, accountId } });
    }
    throw e;
  }
}

export async function syncAnnyForAccount(accountId: number): Promise<AnnySyncResult> {
  const config = await prisma.apiConfig.findFirst({
    where: { accountId, provider: "ANNY" },
  });

  if (!config) {
    throw new Error("anny.co nicht konfiguriert");
  }

  const baseUrl = config.baseUrl?.replace(/\/+$/, "") || DEFAULT_BASE_URL;
  const apiBase = `${baseUrl}/api/v1`;

  const syncCutoff = new Date();
  syncCutoff.setDate(syncCutoff.getDate() - SYNC_WINDOW_DAYS);
  syncCutoff.setHours(0, 0, 0, 0);

  // --- Fetch bookings (only within sync window) ---

  let allBookings: AnnyBooking[] = [];
  let page = 1;
  const pageSize = 100;
  let oldSkipped = 0;

  while (true) {
    const params = new URLSearchParams({
      include: "customer,resource,service",
      "page[size]": String(pageSize),
      "page[number]": String(page),
    });

    const res = await fetch(`${apiBase}/bookings?${params}`, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`anny.co API Fehler: ${res.status} – ${body.slice(0, 300)}`);
    }

    const json = await res.json();
    const bookings = normalizeAnnyBookingsResponse(json);

    let pageOldCount = 0;
    for (const b of bookings) {
      if (b.start_date && new Date(b.start_date) < syncCutoff) {
        pageOldCount++;
        oldSkipped++;
      } else {
        allBookings.push(b);
      }
    }

    if (bookings.length < pageSize) break;
    if (pageOldCount === bookings.length) break;
    if (page >= 100) break;
    page++;
  }

  // --- Discover resources, services, subscriptions ---

  const discoveredServiceNames = new Set<string>();
  const discoveredResourceNames = new Set<string>();
  const discoveredSubscriptionNames = new Set<string>();
  const discoveredResourceIds: Record<string, string> = {};
  const headers = { Authorization: `Bearer ${config.token}`, Accept: "application/json" };

  try {
    let resPage = 1;
    while (resPage <= 20) {
      const rParams = new URLSearchParams({ "page[size]": "50", "page[number]": String(resPage) });
      const rRes = await fetch(`${apiBase}/resources?${rParams}`, { headers, signal: AbortSignal.timeout(10000) });
      if (!rRes.ok) break;
      const rJson = await rRes.json();
      const resources = Array.isArray(rJson) ? rJson : rJson.data || [];
      for (const r of resources) {
        const name = r.name || r.title;
        const id = r.id;
        if (name && id) {
          discoveredResourceNames.add(name);
          discoveredResourceIds[name] = String(id);
        }
      }
      if (resources.length < 50) break;
      resPage++;
    }
  } catch { /* non-critical */ }

  try {
    let svcPage = 1;
    while (svcPage <= 20) {
      const sParams = new URLSearchParams({ "page[size]": "50", "page[number]": String(svcPage) });
      const sRes = await fetch(`${apiBase}/services?${sParams}`, { headers, signal: AbortSignal.timeout(10000) });
      if (!sRes.ok) break;
      const sJson = await sRes.json();
      const services = Array.isArray(sJson) ? sJson : sJson.data || [];
      for (const s of services) {
        const name = s.name || s.title;
        if (name) discoveredServiceNames.add(name);
      }
      if (services.length < 50) break;
      svcPage++;
    }
  } catch { /* non-critical */ }

  try {
    let subPage = 1;
    while (subPage <= 20) {
      const subParams = new URLSearchParams({ "page[size]": "50", "page[number]": String(subPage) });
      const subRes = await fetch(`${apiBase}/subscriptions?${subParams}`, { headers, signal: AbortSignal.timeout(10000) });
      if (!subRes.ok) break;
      const subJson = await subRes.json();
      const subs = Array.isArray(subJson) ? subJson : subJson.data || [];
      for (const s of subs) {
        const name = s.name || s.title || s.plan?.name || s.plan?.title;
        if (name) discoveredSubscriptionNames.add(name);
      }
      if (subs.length < 50) break;
      subPage++;
    }
  } catch { /* non-critical */ }

  try {
    let planPage = 1;
    while (planPage <= 20) {
      const pParams = new URLSearchParams({ "page[size]": "50", "page[number]": String(planPage) });
      const pRes = await fetch(`${apiBase}/plans?${pParams}`, { headers, signal: AbortSignal.timeout(10000) });
      if (!pRes.ok) break;
      const pJson = await pRes.json();
      const plans = Array.isArray(pJson) ? pJson : pJson.data || [];
      for (const p of plans) {
        const name = p.name || p.title;
        if (name) discoveredSubscriptionNames.add(name);
      }
      if (plans.length < 50) break;
      planPage++;
    }
  } catch { /* non-critical */ }

  // --- Fetch plan subscriptions ---

  const allPlanSubscriptions: PlanSubscription[] = [];
  try {
    let psPage = 1;
    while (psPage <= 50) {
      const psParams = new URLSearchParams({
        "page[size]": "50",
        "page[number]": String(psPage),
        include: "customer,plan",
      });
      const psRes = await fetch(`${apiBase}/plan-subscriptions?${psParams}`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!psRes.ok) break;
      const psJson = await psRes.json();
      const psSubs = Array.isArray(psJson) ? psJson : psJson.data || [];
      allPlanSubscriptions.push(...psSubs);
      if (psSubs.length < 50) break;
      psPage++;
    }
  } catch { /* non-critical */ }

  // --- Deduplicate ---

  const seenBookingIds = new Set<string>();
  const uniqueBookings: AnnyBooking[] = [];
  for (const b of allBookings) {
    const bid = String(b.id);
    if (!seenBookingIds.has(bid)) {
      seenBookingIds.add(bid);
      uniqueBookings.push(b);
    }
  }

  let annyConfig: AnnyMapping = {};
  try {
    if (config.extraConfig) annyConfig = JSON.parse(config.extraConfig);
  } catch { /* ignore */ }

  const annyLinks = await prisma.annyResourceLink.findMany({
    where: { accountId },
    select: { annyName: true, accessAreaId: true },
  });
  const areaMappings: Record<string, number> = {};
  for (const link of annyLinks) {
    areaMappings[link.annyName] = link.accessAreaId;
  }

  console.log(`[anny sync] account=${accountId} ${uniqueBookings.length} bookings in window (${SYNC_WINDOW_DAYS}d), ${oldSkipped} older skipped, ${page} pages`);

  // --- Group bookings ---

  const groups = new Map<string, BookingGroup>();
  const cancelledStatuses = new Set(["cancelled", "canceled", "rejected", "no_show"]);

  for (const booking of uniqueBookings) {
    const customer = booking.customer;
    const customerId = customer?.id;

    const serviceName = booking.service?.name || null;
    const resourceName = booking.resource?.name || null;
    const subscriptionName = booking.subscription?.name || booking.subscription?.title || null;
    if (serviceName) discoveredServiceNames.add(serviceName);
    if (resourceName) discoveredResourceNames.add(resourceName);
    if (subscriptionName) discoveredSubscriptionNames.add(subscriptionName);
    const resId = booking.resource?.id;
    if (resId && resourceName) discoveredResourceIds[resourceName] = String(resId);

    if (!customerId) continue;
    if (booking.status && cancelledStatuses.has(booking.status.toLowerCase())) continue;

    const svcId = booking.service?.id ?? booking.resource?.id ?? booking.subscription?.id ?? "none";
    const key = `anny:${customerId}:${svcId}:${booking.id}`;

    const customerName = customer?.full_name || customer?.name || "";
    const nameParts = customerName.split(/\s+/);
    const startDate = booking.start_date ? new Date(booking.start_date) : null;
    const endDate = booking.end_date ? new Date(booking.end_date) : null;

    const entry: BookingEntry = {
      id: String(booking.id),
      start: booking.start_date || null,
      end: booking.end_date || null,
      status: booking.status || null,
    };

    const bookingExtras = extractExtras(booking);
    const existing = groups.get(key);

    if (existing) {
      const isDupeId = existing.entries.some((e) => e.id === entry.id);
      if (!isDupeId) existing.entries.push(entry);
      if (!existing.bookingNumber && booking.number) existing.bookingNumber = booking.number;
      const scan = extractAnnyBookingScanCode(booking);
      if (scan) {
        if (!existing.scanCode) {
          existing.scanCode = scan;
        } else if ((scan.startsWith("!") || /^TIX/i.test(scan)) && !existing.scanCode.startsWith("!")) {
          existing.scanCode = scan;
        }
      }
      if (startDate && (!existing.startDate || startDate < existing.startDate)) existing.startDate = startDate;
      if (endDate && (!existing.endDate || endDate > existing.endDate)) existing.endDate = endDate;
      if (booking.status) existing.statuses.push(booking.status);
      for (const ex of bookingExtras) {
        if (!existing.extras.some((e) => e.name === ex.name)) existing.extras.push(ex);
      }
    } else {
      groups.set(key, {
        key,
        entries: [entry],
        bookingNumber: booking.number || null,
        scanCode: extractAnnyBookingScanCode(booking),
        customerName,
        firstName: customer?.given_name ?? customer?.first_name ?? nameParts[0] ?? "",
        lastName: customer?.family_name ?? customer?.last_name ?? nameParts.slice(1).join(" ") ?? "",
        birthDate: customer?.birth_date ? new Date(customer.birth_date) : null,
        serviceName,
        resourceName,
        subscriptionName,
        startDate,
        endDate,
        statuses: booking.status ? [booking.status] : [],
        extras: bookingExtras,
      });
    }
  }

  // --- Load local mappings ---

  interface ValidityDefaults {
    validityType?: string | null;
    validityDurationMinutes?: number | null;
    slotStart?: string | null;
    slotEnd?: string | null;
  }

  const dbSubscriptions = await prisma.subscription.findMany({
    where: { accountId },
    select: { id: true, annyNames: true, defaultEndDate: true, defaultValidityType: true, defaultValidityDurationMinutes: true, defaultSlotStart: true, defaultSlotEnd: true },
  });
  const subNameMap = new Map<string, number>();
  const subDefaultEndDate = new Map<number, Date | null>();
  const subDefaults = new Map<number, ValidityDefaults>();
  for (const sub of dbSubscriptions) {
    subDefaultEndDate.set(sub.id, sub.defaultEndDate);
    subDefaults.set(sub.id, {
      validityType: sub.defaultValidityType,
      validityDurationMinutes: sub.defaultValidityDurationMinutes,
      slotStart: sub.defaultSlotStart,
      slotEnd: sub.defaultSlotEnd,
    });
    if (sub.annyNames) {
      try {
        const names: string[] = JSON.parse(sub.annyNames);
        for (const n of names) subNameMap.set(n, sub.id);
      } catch { /* ignore */ }
    }
  }

  const servicesList = await prisma.service.findMany({
    where: { accountId },
    select: { id: true, annyNames: true, defaultValidityType: true, defaultValidityDurationMinutes: true, defaultSlotStart: true, defaultSlotEnd: true },
  });
  const svcNameMap = new Map<string, number>();
  const svcDefaults = new Map<number, ValidityDefaults>();
  for (const svc of servicesList) {
    svcDefaults.set(svc.id, {
      validityType: svc.defaultValidityType,
      validityDurationMinutes: svc.defaultValidityDurationMinutes,
      slotStart: svc.defaultSlotStart,
      slotEnd: svc.defaultSlotEnd,
    });
    if (svc.annyNames) {
      try {
        const names: string[] = JSON.parse(svc.annyNames);
        for (const n of names) svcNameMap.set(n, svc.id);
      } catch { /* ignore */ }
    }
  }

  // --- Upsert tickets ---

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails: string[] = [];
  const activeUuids: string[] = [];
  const usedBarcodes = new Set<string>();
  const unmapped: { annyName: string; count: number; customerSample: string[] }[] = [];
  const unmappedNames = new Map<string, { count: number; customers: Set<string> }>();

  const allGroupUuids = [...groups.keys()];
  const legacyUuids = [...new Set(allGroupUuids.map((k) => k.split(":").slice(0, 3).join(":")))];
  const allLookupUuids = [...new Set([...allGroupUuids, ...legacyUuids])];
  const existingTickets = allLookupUuids.length > 0
    ? await prisma.ticket.findMany({
        where: { accountId, uuid: { in: allLookupUuids } },
        select: { id: true, uuid: true },
      })
    : [];
  const existingByUuid = new Map(existingTickets.map((t) => [t.uuid, t.id]));
  const claimedLegacy = new Set<string>();

  for (const group of groups.values()) {
    const uuid = group.key;
    const count = group.entries.length;

    group.entries.sort((a, b) => {
      if (!a.start) return 1;
      if (!b.start) return -1;
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });

    const displayName = group.serviceName || group.resourceName || group.subscriptionName || null;
    let typeName = displayName;
    if (typeName && count > 1) typeName = `${typeName} (${count} Termine)`;

    let subscriptionId: number | null = null;
    let serviceId: number | null = null;
    let accessAreaId: number | null = null;

    if (group.subscriptionName && subNameMap.has(group.subscriptionName)) {
      subscriptionId = subNameMap.get(group.subscriptionName)!;
    } else if (group.serviceName && subNameMap.has(group.serviceName)) {
      subscriptionId = subNameMap.get(group.serviceName)!;
    } else if (group.resourceName && subNameMap.has(group.resourceName)) {
      subscriptionId = subNameMap.get(group.resourceName)!;
    }

    if (!subscriptionId) {
      if (group.serviceName && svcNameMap.has(group.serviceName)) {
        serviceId = svcNameMap.get(group.serviceName)!;
      } else if (group.resourceName && svcNameMap.has(group.resourceName)) {
        serviceId = svcNameMap.get(group.resourceName)!;
      }
    }

    if (group.serviceName && areaMappings[group.serviceName]) {
      accessAreaId = areaMappings[group.serviceName];
    } else if (group.resourceName && areaMappings[group.resourceName]) {
      accessAreaId = areaMappings[group.resourceName];
    }

    if (!subscriptionId && !serviceId && !accessAreaId) {
      const unmappedKey = displayName || "Unbekannt";
      const entry = unmappedNames.get(unmappedKey);
      if (entry) {
        entry.count += count;
        if (group.customerName && entry.customers.size < 3) entry.customers.add(group.customerName);
      } else {
        const customers = new Set<string>();
        if (group.customerName) customers.add(group.customerName);
        unmappedNames.set(unmappedKey, { count, customers });
      }
      skipped++;
      continue;
    }

    activeUuids.push(uuid);

    let barcode = group.scanCode || group.bookingNumber || null;
    if (barcode && usedBarcodes.has(barcode)) {
      barcode = group.bookingNumber && !usedBarcodes.has(group.bookingNumber)
        ? group.bookingNumber
        : null;
    }
    if (barcode) usedBarcodes.add(barcode);

    const defaults = (serviceId && svcDefaults.get(serviceId))
      || (subscriptionId && subDefaults.get(subscriptionId))
      || {};

    const ticketData = {
      name: group.customerName || `Buchung ${group.entries[0].id}`,
      firstName: group.firstName || null,
      lastName: group.lastName || null,
      birthDate: group.birthDate,
      startDate: group.startDate,
      endDate: group.endDate,
      status: mapGroupStatus(group.statuses),
      ticketTypeName: typeName,
      barcode,
      qrCode: JSON.stringify(group.entries),
      extras: group.extras.length > 0 ? JSON.parse(JSON.stringify(group.extras)) : undefined,
      source: "ANNY" as const,
      accessAreaId,
      subscriptionId,
      serviceId,
      ...(defaults.validityType ? { validityType: defaults.validityType as "DATE_RANGE" | "DURATION" | "TIME_SLOT" } : {}),
      ...(defaults.validityDurationMinutes != null ? { validityDurationMinutes: defaults.validityDurationMinutes } : {}),
      ...(defaults.slotStart ? { slotStart: defaults.slotStart } : {}),
      ...(defaults.slotEnd ? { slotEnd: defaults.slotEnd } : {}),
    };

    try {
      const existingId = existingByUuid.get(uuid);
      if (existingId) {
        await prisma.ticket.update({ where: { id: existingId }, data: { ...ticketData, uuid } });
        updated++;
      } else {
        const legacy = uuid.split(":").slice(0, 3).join(":");
        if (!claimedLegacy.has(legacy) && existingByUuid.has(legacy)) {
          const claimed = await prisma.ticket.updateMany({
            where: { id: existingByUuid.get(legacy)!, uuid: legacy },
            data: { ...ticketData, uuid },
          });
          if (claimed.count > 0) {
            claimedLegacy.add(legacy);
            updated++;
          } else {
            await createTicketSafe(ticketData, uuid, accountId);
            created++;
          }
        } else {
          await createTicketSafe(ticketData, uuid, accountId);
          created++;
        }
      }
    } catch (e) {
      if (barcode) usedBarcodes.delete(barcode);
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[anny sync] ticket error uuid=${uuid} barcode=${barcode}:`, msg);
      errorDetails.push(`${uuid}: ${msg.slice(0, 120)}`);
      errors++;
    }
  }

  // --- Plan subscriptions ---

  let subCreated = 0;
  let subUpdated = 0;

  const subUuids = allPlanSubscriptions
    .filter((ps) => ps.customer?.id)
    .map((ps) => `anny-sub:${ps.customer!.id}:${ps.id ?? ps.plan?.name ?? ps.plan?.title ?? ps.name?.replace(/#\d+$/, "").trim() ?? ""}`);
  const existingSubTickets = subUuids.length > 0
    ? await prisma.ticket.findMany({
        where: { accountId, uuid: { in: subUuids } },
        select: { id: true, uuid: true },
      })
    : [];
  const existingSubByUuid = new Map(existingSubTickets.map((t) => [t.uuid, t.id]));

  for (const ps of allPlanSubscriptions) {
    const customerId = ps.customer?.id;
    if (!customerId) continue;

    const planName = ps.plan?.name ?? ps.plan?.title ?? ps.name?.replace(/#\d+$/, "").trim() ?? null;
    if (!planName) continue;

    const subscriptionId = subNameMap.get(planName) ?? null;
    if (!subscriptionId) continue;

    const ticketStatus =
      ps.status === "active" || ps.status === "trialing" ? ("VALID" as const)
      : ps.status === "paused" ? ("PAUSED" as const)
      : ps.status === "canceled" || ps.status === "cancelled" ? ("CANCELED" as const)
      : ("INVALID" as const);

    const uuid = `anny-sub:${customerId}:${ps.id ?? planName}`;
    if (ticketStatus === "VALID") activeUuids.push(uuid);

    const customerName = ps.customer?.full_name ?? "";
    const firstName = ps.customer?.given_name ?? customerName.split(/\s+/)[0] ?? "";
    const lastName = ps.customer?.family_name ?? customerName.split(/\s+/).slice(1).join(" ") ?? "";

    const startDate = ps.starts_at ? new Date(ps.starts_at) : null;
    const endDate = calcSubscriptionEndDate(ps, startDate, planName, subscriptionId, subDefaultEndDate);
    const birthDate = ps.customer?.birth_date ? new Date(ps.customer.birth_date) : null;

    const ticketData = {
      name: customerName || `Abo ${ps.id ?? ""}`,
      firstName: firstName || null,
      lastName: lastName || null,
      birthDate,
      startDate,
      endDate,
      status: ticketStatus,
      ticketTypeName: planName,
      source: "ANNY" as const,
      subscriptionId,
      accessAreaId: null as number | null,
      serviceId: null as number | null,
    };

    try {
      const existingId = existingSubByUuid.get(uuid);
      if (existingId) {
        await prisma.ticket.update({ where: { id: existingId }, data: ticketData });
        subUpdated++;
      } else {
        await prisma.ticket.create({ data: { ...ticketData, uuid, accountId } });
        subCreated++;
      }
    } catch { /* skip */ }
  }

  created += subCreated;
  updated += subUpdated;

  for (const [name, { count, customers }] of unmappedNames) {
    unmapped.push({ annyName: name, count, customerSample: [...customers] });
  }

  // --- Invalidate orphans (only within sync window) ---

  const orphaned = await prisma.ticket.updateMany({
    where: {
      accountId,
      source: "ANNY",
      uuid: { notIn: activeUuids },
      status: { not: "INVALID" },
      OR: [
        { startDate: { gte: syncCutoff } },
        { uuid: { startsWith: "anny-sub:" } },
      ],
    },
    data: { status: "INVALID" },
  });

  // --- Update config ---

  const updatedAnnyConfig: AnnyMapping = {
    ...annyConfig,
    services: [...discoveredServiceNames].sort(),
    resources: [...discoveredResourceNames].sort(),
    subscriptions: [...discoveredSubscriptionNames].sort(),
    resourceIds: { ...(annyConfig.resourceIds || {}), ...discoveredResourceIds },
  };

  await prisma.apiConfig.update({
    where: { id: config.id },
    data: {
      lastUpdate: new Date(),
      extraConfig: JSON.stringify(updatedAnnyConfig),
    },
  });

  // --- Update service cache on AnnyResourceLink ---

  try {
    const linksToUpdate = await prisma.annyResourceLink.findMany({ where: { accountId } });
    if (linksToUpdate.length > 0) {
      const svcMap = new Map<string, { interval: number; price: string }>();
      for (let pg = 1; pg <= 5; pg++) {
        const res = await fetch(
          `${baseUrl}/api/v1/services?page[size]=50&page[number]=${pg}`,
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
          if (interval > 0) svcMap.set(name, { interval, price });
        }
        if (items.length < 50) break;
      }
      for (const link of linksToUpdate) {
        const svc = svcMap.get(link.annyName);
        if (!svc) continue;
        if (link.bookingInterval !== svc.interval || (link.priceLabel ?? "") !== svc.price) {
          await prisma.annyResourceLink.update({
            where: { id: link.id },
            data: { bookingInterval: svc.interval, priceLabel: svc.price },
          });
        }
      }
    }
  } catch { /* best-effort */ }

  return {
    created,
    updated,
    skipped,
    errors,
    errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 20) : undefined,
    invalidated: orphaned.count,
    total: uniqueBookings.length,
    oldSkipped,
    syncWindowDays: SYNC_WINDOW_DAYS,
    pages: page,
    groups: groups.size,
    resources: discoveredResourceNames.size,
    services: discoveredServiceNames.size,
    subscriptions: discoveredSubscriptionNames.size,
    planSubscriptions: allPlanSubscriptions.length,
    planSubscriptionsCreated: subCreated,
    planSubscriptionsUpdated: subUpdated,
    unmapped,
  };
}
