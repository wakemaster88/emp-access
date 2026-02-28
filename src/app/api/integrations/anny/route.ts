import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

const DEFAULT_BASE_URL = "https://b.anny.co";

interface AnnyBooking {
  id: string | number;
  number?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  created_at?: string;
  customer?: {
    id?: string | number;
    full_name?: string;
    name?: string;
    email?: string;
    first_name?: string;
    last_name?: string;
  };
  resource?: {
    id?: string | number;
    name?: string;
  };
  service?: {
    id?: string | number;
    name?: string;
  };
  subscription?: {
    id?: string | number;
    name?: string;
    title?: string;
  };
}

interface BookingEntry {
  id: string;
  start: string | null;
  end: string | null;
  status: string | null;
}

interface BookingGroup {
  key: string;
  entries: BookingEntry[];
  customerName: string;
  firstName: string;
  lastName: string;
  serviceName: string | null;
  resourceName: string | null;
  subscriptionName: string | null;
  startDate: Date | null;
  endDate: Date | null;
  statuses: string[];
}

interface AnnyMapping {
  mappings?: Record<string, number>;
  services?: string[];
  resources?: string[];
  subscriptions?: string[];
  resourceIds?: Record<string, string>;
}

function mapGroupStatus(statuses: string[]): "VALID" | "INVALID" | "REDEEMED" {
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

export const maxDuration = 60;

export async function POST() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;

  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "ANNY" },
  });

  if (!config) {
    return NextResponse.json({ error: "anny.co nicht konfiguriert" }, { status: 404 });
  }

  try {
    const baseUrl = config.baseUrl?.replace(/\/+$/, "") || DEFAULT_BASE_URL;
    const apiBase = `${baseUrl}/api/v1`;

    let allBookings: AnnyBooking[] = [];
    let page = 1;
    const pageSize = 30;

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
        return NextResponse.json(
          { error: `anny.co API Fehler: ${res.status} – ${body.slice(0, 300)}` },
          { status: 502 }
        );
      }

      const json = await res.json();
      const bookings: AnnyBooking[] = Array.isArray(json) ? json : json.data || [];
      allBookings = allBookings.concat(bookings);

      if (bookings.length < pageSize || page >= 50) break;
      page++;
    }

    // Fetch all resources, services & subscriptions from anny API
    const discoveredServiceNames = new Set<string>();
    const discoveredResourceNames = new Set<string>();
    const discoveredSubscriptionNames = new Set<string>();
    const discoveredResourceIds: Record<string, string> = {};

    // GET /api/v1/resources
    try {
      let resPage = 1;
      while (resPage <= 20) {
        const rParams = new URLSearchParams({ "page[size]": "50", "page[number]": String(resPage) });
        const rRes = await fetch(`${apiBase}/resources?${rParams}`, {
          headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        });
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

    // GET /api/v1/services
    try {
      let svcPage = 1;
      while (svcPage <= 20) {
        const sParams = new URLSearchParams({ "page[size]": "50", "page[number]": String(svcPage) });
        const sRes = await fetch(`${apiBase}/services?${sParams}`, {
          headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        });
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

    // GET /api/v1/plans (offered plans / subscriptions)
    try {
      let planPage = 1;
      while (planPage <= 20) {
        const pParams = new URLSearchParams({ "page[size]": "50", "page[number]": String(planPage) });
        const pRes = await fetch(`${apiBase}/plans?${pParams}`, {
          headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        });
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

    // Deduplicate bookings by ID
    const seenBookingIds = new Set<string>();
    const uniqueBookings: AnnyBooking[] = [];
    for (const b of allBookings) {
      const bid = String(b.id);
      if (!seenBookingIds.has(bid)) {
        seenBookingIds.add(bid);
        uniqueBookings.push(b);
      }
    }

    // Parse area mapping from extraConfig
    let annyConfig: AnnyMapping = {};
    try {
      if (config.extraConfig) annyConfig = JSON.parse(config.extraConfig);
    } catch { /* ignore invalid JSON */ }
    const areaMappings = annyConfig.mappings || {};

    // Group bookings by customer + service/resource
    const groups = new Map<string, BookingGroup>();

    for (const booking of uniqueBookings) {
      const customer = booking.customer;
      const customerId = customer?.id;

      // Skip resource reservations without customer (e.g. Ferienkurs blocking lifts)
      if (!customerId) {
        const serviceName = booking.service?.name || null;
        const resourceName = booking.resource?.name || null;
        if (serviceName) discoveredServiceNames.add(serviceName);
        if (resourceName) discoveredResourceNames.add(resourceName);
        const resId = booking.resource?.id;
        if (resId && resourceName) discoveredResourceIds[resourceName] = String(resId);
        continue;
      }

      const serviceId = booking.service?.id ?? booking.resource?.id ?? "none";
      const key = `anny:${customerId}:${serviceId}`;

      const customerName = customer?.full_name || customer?.name || "";
      const nameParts = customerName.split(/\s+/);

      const serviceName = booking.service?.name || null;
      const resourceName = booking.resource?.name || null;
      if (serviceName) discoveredServiceNames.add(serviceName);
      if (resourceName) discoveredResourceNames.add(resourceName);

      const resId = booking.resource?.id;
      if (resId && resourceName) {
        discoveredResourceIds[resourceName] = String(resId);
      }

      const startDate = booking.start_date ? new Date(booking.start_date) : null;
      const endDate = booking.end_date ? new Date(booking.end_date) : null;

      const entry: BookingEntry = {
        id: String(booking.id),
        start: booking.start_date || null,
        end: booking.end_date || null,
        status: booking.status || null,
      };

      const existing = groups.get(key);
      if (existing) {
        if (!existing.entries.some((e) => e.id === entry.id)) {
          existing.entries.push(entry);
        }
        if (startDate && (!existing.startDate || startDate < existing.startDate)) {
          existing.startDate = startDate;
        }
        if (endDate && (!existing.endDate || endDate > existing.endDate)) {
          existing.endDate = endDate;
        }
        if (booking.status) existing.statuses.push(booking.status);
      } else {
        groups.set(key, {
          key,
          entries: [entry],
          customerName,
          firstName: customer?.first_name || nameParts[0] || "",
          lastName: customer?.last_name || nameParts.slice(1).join(" ") || "",
          serviceName,
          resourceName,
          subscriptionName: null,
          startDate,
          endDate,
          statuses: booking.status ? [booking.status] : [],
        });
      }
    }

    // Load subscriptions for anny name matching
    const subscriptions = await db.subscription.findMany({
      where: { accountId: accountId! },
      select: { id: true, annyNames: true },
    });
    const subNameMap = new Map<string, number>();
    for (const sub of subscriptions) {
      if (sub.annyNames) {
        try {
          const names: string[] = JSON.parse(sub.annyNames);
          for (const n of names) subNameMap.set(n, sub.id);
        } catch { /* ignore */ }
      }
    }

    // Load services for anny name matching
    const servicesList = await db.service.findMany({
      where: { accountId: accountId! },
      select: { id: true, annyNames: true },
    });
    const svcNameMap = new Map<string, number>();
    for (const svc of servicesList) {
      if (svc.annyNames) {
        try {
          const names: string[] = JSON.parse(svc.annyNames);
          for (const n of names) svcNameMap.set(n, svc.id);
        } catch { /* ignore */ }
      }
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const activeUuids: string[] = [];
    const unmapped: { annyName: string; count: number; customerSample: string[] }[] = [];
    const unmappedNames = new Map<string, { count: number; customers: Set<string> }>();

    for (const group of groups.values()) {
      const uuid = group.key;
      const count = group.entries.length;

      group.entries.sort((a, b) => {
        if (!a.start) return 1;
        if (!b.start) return -1;
        return new Date(a.start).getTime() - new Date(b.start).getTime();
      });

      const displayName = group.serviceName || group.resourceName || null;
      let typeName = displayName;
      if (typeName && count > 1) {
        typeName = `${typeName} (${count} Termine)`;
      }

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

      if (!subscriptionId && !serviceId) {
        if (group.serviceName && areaMappings[group.serviceName]) {
          accessAreaId = areaMappings[group.serviceName];
        } else if (group.resourceName && areaMappings[group.resourceName]) {
          accessAreaId = areaMappings[group.resourceName];
        }
      }

      // Skip groups without any service/subscription/area mapping
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

      const ticketData = {
        name: group.customerName || `Buchung ${group.entries[0].id}`,
        firstName: group.firstName || null,
        lastName: group.lastName || null,
        startDate: group.startDate,
        endDate: group.endDate,
        status: mapGroupStatus(group.statuses),
        ticketTypeName: typeName,
        barcode: uuid,
        qrCode: JSON.stringify(group.entries),
        source: "ANNY" as const,
        accessAreaId,
        subscriptionId,
        serviceId,
      };

      try {
        const existingTicket = await db.ticket.findFirst({
          where: { uuid, accountId: accountId! },
        });

        if (existingTicket) {
          await db.ticket.update({
            where: { id: existingTicket.id },
            data: ticketData,
          });
          updated++;
        } else {
          await db.ticket.create({
            data: { ...ticketData, uuid, accountId: accountId! },
          });
          created++;
        }
      } catch {
        skipped++;
      }
    }

    // Build unmapped warnings
    for (const [name, { count, customers }] of unmappedNames) {
      unmapped.push({ annyName: name, count, customerSample: [...customers] });
    }

    // Mark anny tickets that no longer exist as INVALID
    const orphaned = await db.ticket.updateMany({
      where: {
        accountId: accountId!,
        source: "ANNY",
        uuid: { notIn: activeUuids },
        status: { not: "INVALID" },
      },
      data: { status: "INVALID" },
    });

    // Persist discovered service/resource/subscription names + resource IDs
    const updatedConfig: AnnyMapping = {
      ...annyConfig,
      services: [...discoveredServiceNames].sort(),
      resources: [...discoveredResourceNames].sort(),
      subscriptions: [...discoveredSubscriptionNames].sort(),
      resourceIds: { ...(annyConfig.resourceIds || {}), ...discoveredResourceIds },
    };

    await db.apiConfig.update({
      where: { id: config.id },
      data: {
        lastUpdate: new Date(),
        extraConfig: JSON.stringify(updatedConfig),
      },
    });

    return NextResponse.json({
      created,
      updated,
      skipped,
      invalidated: orphaned.count,
      total: allBookings.length,
      groups: groups.size,
      resources: discoveredResourceNames.size,
      services: discoveredServiceNames.size,
      subscriptions: discoveredSubscriptionNames.size,
      unmapped,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unbekannt";
    console.error("[anny sync error]", msg);
    return NextResponse.json(
      { error: `Sync fehlgeschlagen: ${msg}` },
      { status: 500 }
    );
  }
}
