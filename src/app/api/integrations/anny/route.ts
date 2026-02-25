import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;

  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "ANNY" },
  });

  if (!config) {
    return NextResponse.json({ error: "anny.co not configured" }, { status: 404 });
  }

  try {
    const baseUrl = config.baseUrl || "https://api.anny.co";
    const since = config.lastUpdate?.toISOString() || new Date(0).toISOString();

    const res = await fetch(`${baseUrl}/v1/bookings?since=${since}`, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `anny.co API error: ${res.status}` },
        { status: 502 }
      );
    }

    const bookings = await res.json();
    let created = 0;
    let updated = 0;

    for (const booking of Array.isArray(bookings) ? bookings : bookings.data || []) {
      const uuid = booking.id || booking.uuid;
      const existing = await db.ticket.findFirst({ where: { uuid } });

      const ticketData = {
        name: `${booking.firstName || ""} ${booking.lastName || ""}`.trim() || booking.title || "anny Booking",
        barcode: booking.barcode || booking.code,
        firstName: booking.firstName,
        lastName: booking.lastName,
        startDate: booking.startAt ? new Date(booking.startAt) : undefined,
        endDate: booking.endAt ? new Date(booking.endAt) : undefined,
        status: booking.cancelled ? "INVALID" as const : "VALID" as const,
        ticketTypeName: booking.resourceName || booking.type,
        source: "ANNY" as const,
      };

      if (existing) {
        await db.ticket.update({ where: { id: existing.id }, data: ticketData });
        updated++;
      } else {
        await db.ticket.create({
          data: { ...ticketData, uuid, accountId: accountId! },
        });
        created++;
      }
    }

    await db.apiConfig.update({
      where: { id: config.id },
      data: { lastUpdate: new Date() },
    });

    return NextResponse.json({ created, updated });
  } catch (err) {
    return NextResponse.json(
      { error: `Sync failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }
}
