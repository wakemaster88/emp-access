import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";

/**
 * Webhook für anny.co: neue/geänderte Buchungen per POST.
 * Auth: Header "Authorization: Bearer <webhookSecret>" oder "X-Webhook-Secret: <webhookSecret>".
 * Body: { "booking": {...} } oder { "bookings": [...] } bzw. { "data": { "booking" } } / { "data": { "bookings" } }
 * Booking-Format wie anny API: id, start_date, end_date, status, customer: { id, full_name, first_name, last_name }, resource?, service?
 */

interface AnnyBooking {
  id?: string | number;
  start_date?: string;
  end_date?: string;
  status?: string;
  customer?: {
    id?: string | number;
    full_name?: string;
    first_name?: string;
    last_name?: string;
  };
  resource?: { id?: string | number; name?: string };
  service?: { id?: string | number; name?: string };
}

interface AnnyMapping {
  mappings?: Record<string, number>;
}

function mapStatus(s: string | undefined): "VALID" | "INVALID" | "REDEEMED" {
  const lower = (s ?? "").toLowerCase();
  if (["cancelled", "canceled", "rejected", "no_show"].includes(lower)) return "INVALID";
  if (["checked_out", "completed"].includes(lower)) return "REDEEMED";
  return "VALID";
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const secretHeader = request.headers.get("x-webhook-secret");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : secretHeader?.trim();

  if (!token) {
    return NextResponse.json(
      { error: "Missing webhook secret (Authorization: Bearer … or X-Webhook-Secret)" },
      { status: 401 }
    );
  }

  const configs = await prisma.apiConfig.findMany({
    where: { provider: "ANNY" },
  });

  let config: (typeof configs)[0] | null = null;
  for (const c of configs) {
    try {
      const extra = c.extraConfig ? JSON.parse(c.extraConfig) : {};
      if (extra.webhookSecret === token) {
        config = c;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!config) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  const accountId = config.accountId;
  const db = tenantClient(accountId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data = (body as { data?: { booking?: AnnyBooking; bookings?: AnnyBooking[] } }).data;
  const rawBooking = (body as { booking?: AnnyBooking }).booking;
  const rawBookings = (body as { bookings?: AnnyBooking[] }).bookings;

  let bookings: AnnyBooking[] = [];
  if (Array.isArray(rawBookings)) bookings = rawBookings;
  else if (Array.isArray(data?.bookings)) bookings = data.bookings;
  else if (rawBooking && typeof rawBooking === "object") bookings = [rawBooking];
  else if (data?.booking && typeof data.booking === "object") bookings = [data.booking];

  if (bookings.length === 0) {
    return NextResponse.json(
      { error: "Body must contain booking, bookings, or data.booking / data.bookings" },
      { status: 400 }
    );
  }

  let annyConfig: AnnyMapping = {};
  try {
    if (config.extraConfig) annyConfig = JSON.parse(config.extraConfig);
  } catch { /* ignore */ }
  const areaMappings = annyConfig.mappings || {};

  const subscriptions = await db.subscription.findMany({
    where: { accountId },
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

  const servicesList = await db.service.findMany({
    where: { accountId },
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

  for (const booking of bookings) {
    const customerId = booking.customer?.id;
    if (customerId == null) continue;

    const serviceId = booking.service?.id ?? booking.resource?.id ?? "none";
    const uuid = `anny:${customerId}:${serviceId}`;

    const customer = booking.customer;
    const customerName = customer?.full_name || [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || "";
    const nameParts = (customerName || "").split(/\s+/);
    const firstName = customer?.first_name ?? nameParts[0] ?? null;
    const lastName = customer?.last_name ?? (nameParts.slice(1).join(" ") || null);

    const serviceName = booking.service?.name ?? null;
    const resourceName = booking.resource?.name ?? null;

    let subscriptionId: number | null = null;
    let serviceIdNum: number | null = null;
    let accessAreaId: number | null = null;

    if (serviceName && subNameMap.has(serviceName)) subscriptionId = subNameMap.get(serviceName)!;
    else if (resourceName && subNameMap.has(resourceName)) subscriptionId = subNameMap.get(resourceName)!;

    if (!subscriptionId) {
      if (serviceName && svcNameMap.has(serviceName)) serviceIdNum = svcNameMap.get(serviceName)!;
      else if (resourceName && svcNameMap.has(resourceName)) serviceIdNum = svcNameMap.get(resourceName)!;
    }

    if (!subscriptionId && !serviceIdNum) {
      if (serviceName && areaMappings[serviceName]) accessAreaId = areaMappings[serviceName];
      else if (resourceName && areaMappings[resourceName]) accessAreaId = areaMappings[resourceName];
    }

    const startDate = booking.start_date ? new Date(booking.start_date) : null;
    const endDate = booking.end_date ? new Date(booking.end_date) : null;
    const status = mapStatus(booking.status);

    const ticketData = {
      name: customerName || `Buchung ${booking.id ?? ""}`,
      firstName,
      lastName,
      startDate,
      endDate,
      status,
      barcode: uuid,
      qrCode: JSON.stringify([{ id: String(booking.id), start: booking.start_date ?? null, end: booking.end_date ?? null, status: booking.status ?? null }]),
      source: "ANNY" as const,
      accessAreaId,
      subscriptionId,
      serviceId: serviceIdNum,
    };

    try {
      const existing = await db.ticket.findFirst({
        where: { uuid, accountId },
      });
      if (existing) {
        await db.ticket.update({
          where: { id: existing.id },
          data: ticketData,
        });
        updated++;
      } else {
        await db.ticket.create({
          data: { ...ticketData, uuid, accountId },
        });
        created++;
      }
    } catch {
      // skip on conflict/error
    }
  }

  return NextResponse.json({ created, updated });
}
