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
  startDate: Date | null;
  endDate: Date | null;
  statuses: string[];
}

interface AnnyMapping {
  mappings?: Record<string, number>;
  services?: string[];
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

    // Parse area mapping from extraConfig
    let annyConfig: AnnyMapping = {};
    try {
      if (config.extraConfig) annyConfig = JSON.parse(config.extraConfig);
    } catch { /* ignore invalid JSON */ }
    const areaMappings = annyConfig.mappings || {};

    // Group bookings by customer + service/resource
    const groups = new Map<string, BookingGroup>();
    const discoveredServices = new Set<string>();

    for (const booking of allBookings) {
      const customerId = booking.customer?.id ?? "unknown";
      const serviceId = booking.service?.id ?? booking.resource?.id ?? "none";
      const key = `anny:${customerId}:${serviceId}`;

      const customer = booking.customer;
      const customerName = customer?.full_name || customer?.name || "";
      const nameParts = customerName.split(/\s+/);

      const serviceName = booking.service?.name || null;
      const resourceName = booking.resource?.name || null;
      if (serviceName) discoveredServices.add(serviceName);
      if (resourceName) discoveredServices.add(resourceName);

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
        existing.entries.push(entry);
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
          startDate,
          endDate,
          statuses: booking.status ? [booking.status] : [],
        });
      }
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const activeUuids: string[] = [];

    for (const group of groups.values()) {
      const uuid = group.key;
      activeUuids.push(uuid);
      const count = group.entries.length;

      // Sort entries by start date
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

      let accessAreaId: number | null = null;
      if (group.serviceName && areaMappings[group.serviceName]) {
        accessAreaId = areaMappings[group.serviceName];
      } else if (group.resourceName && areaMappings[group.resourceName]) {
        accessAreaId = areaMappings[group.resourceName];
      }

      const ticketData = {
        name: group.customerName || `Buchung ${group.entries[0].id}`,
        firstName: group.firstName || null,
        lastName: group.lastName || null,
        startDate: group.startDate,
        endDate: group.endDate,
        status: mapGroupStatus(group.statuses),
        ticketTypeName: typeName,
        qrCode: JSON.stringify(group.entries),
        source: "ANNY" as const,
        accessAreaId,
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

    // Persist discovered service/resource names (keep existing mappings)
    const updatedConfig: AnnyMapping = {
      ...annyConfig,
      services: [...discoveredServices].sort(),
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
