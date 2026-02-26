import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

const ANNY_REGIONS: Record<string, string> = {
  co: "https://b.anny.co",
  eu: "https://b.anny.eu",
  staging: "https://b.staging.anny.co",
};

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

function mapAnnyStatus(status?: string): "VALID" | "INVALID" | "REDEEMED" {
  if (!status) return "VALID";
  const s = status.toLowerCase();
  if (s === "cancelled" || s === "canceled" || s === "rejected" || s === "no_show") return "INVALID";
  if (s === "checked_out" || s === "completed") return "REDEEMED";
  return "VALID";
}

export async function POST(request: NextRequest) {
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
    const region = config.extraConfig || "co";
    const baseUrl = config.baseUrl?.replace(/\/+$/, "") || ANNY_REGIONS[region] || ANNY_REGIONS.co;

    let allBookings: AnnyBooking[] = [];
    let page = 1;
    const pageSize = 30;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        "include": "customer,resource,service",
        "page[size]": String(pageSize),
        "page[number]": String(page),
      });

      const res = await fetch(`${baseUrl}/api/v1/bookings?${params}`, {
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return NextResponse.json(
          { error: `anny.co API Fehler: ${res.status} – ${body.slice(0, 200)}` },
          { status: 502 }
        );
      }

      const json = await res.json();
      const bookings: AnnyBooking[] = Array.isArray(json) ? json : json.data || [];
      allBookings = allBookings.concat(bookings);

      if (bookings.length < pageSize) {
        hasMore = false;
      } else {
        page++;
        if (page > 100) break;
      }
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const booking of allBookings) {
      const uuid = String(booking.id);
      const customer = booking.customer;
      const customerName = customer?.full_name || customer?.name || "";
      const nameParts = customerName.split(/\s+/);
      const firstName = customer?.first_name || nameParts[0] || "";
      const lastName = customer?.last_name || nameParts.slice(1).join(" ") || "";

      const ticketData = {
        name: customerName || `Buchung #${booking.number || uuid}`,
        firstName: firstName || null,
        lastName: lastName || null,
        startDate: booking.start_date ? new Date(booking.start_date) : null,
        endDate: booking.end_date ? new Date(booking.end_date) : null,
        status: mapAnnyStatus(booking.status),
        ticketTypeName: booking.service?.name || booking.resource?.name || null,
        source: "ANNY" as const,
      };

      try {
        const existing = await db.ticket.findFirst({
          where: { uuid, accountId: accountId! },
        });

        if (existing) {
          await db.ticket.update({ where: { id: existing.id }, data: ticketData });
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

    await db.apiConfig.update({
      where: { id: config.id },
      data: { lastUpdate: new Date() },
    });

    return NextResponse.json({
      created,
      updated,
      skipped,
      total: allBookings.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Sync fehlgeschlagen: ${err instanceof Error ? err.message : "unbekannt"}` },
      { status: 500 }
    );
  }
}
