import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicRateLimit } from "@/lib/rate-limit";
import { addCalendarDays, berlinDayRange, berlinYmd } from "@/lib/berlin-day";
import {
  eventInclude,
  loadBusyBlocks,
  loadPortalPartner,
  loadVenues,
  notifyStaff,
  saveEvent,
  serializeEventForPartner,
} from "@/lib/venue-events";
import { eventInputSchema } from "@/lib/venue-event-rules";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/**
 * Partner-Portal: eigene Termine (kommende plus 180 Tage zurück) mit
 * Zusatzleistungen und Dokumenten, die freigegebenen Räume samt Katalog und
 * fremde Belegungen nur als Zeitraum. Öffentlich, Zugang nur über den
 * geheimen Link.
 */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const { token } = await params;
  const limited = publicRateLimit(token, "partner-portal-read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const partner = await loadPortalPartner(token);
  if (!partner) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const today = berlinYmd(new Date());
  const horizonEnd = addCalendarDays(today, partner.horizonDays);
  const [venues, extras, events, busy] = await Promise.all([
    loadVenues(partner.accountId, partner.areaIds),
    prisma.venueExtra.findMany({
      where: { accountId: partner.accountId, areaId: { in: partner.areaIds }, active: true },
      select: { id: true, areaId: true, name: true, description: true, priceCents: true, unit: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.venueEvent.findMany({
      where: { accountId: partner.accountId, partnerId: partner.id, date: { gte: addCalendarDays(today, -180) } },
      include: eventInclude,
      orderBy: { startDate: "asc" },
      take: 500,
    }),
    loadBusyBlocks(
      partner.accountId,
      partner.areaIds,
      partner.id,
      berlinDayRange(today).start,
      berlinDayRange(addCalendarDays(horizonEnd, 1)).start,
    ),
  ]);

  return NextResponse.json({
    partner: {
      name: partner.name,
      accountName: partner.account.name,
      editLockHours: partner.editLockHours,
      horizon: { from: today, to: horizonEnd },
    },
    venues: venues.map((v) => ({ id: v.id, name: v.name, bufferMinutes: v.eventBufferMinutes, capacity: v.eventCapacity })),
    extras,
    events: events.map((e) => serializeEventForPartner(e, partner.editLockHours)),
    busy,
  });
}

/** Neuer Termin des Partners. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { token } = await params;
  const limited = publicRateLimit(token, "partner-portal-write", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const partner = await loadPortalPartner(token);
  if (!partner) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const parsed = eventInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });

  const upcoming = await prisma.venueEvent.count({
    where: { accountId: partner.accountId, partnerId: partner.id, status: { not: "CANCELED" }, startDate: { gt: new Date() } },
  });
  if (upcoming >= 200) return NextResponse.json({ error: "Ihr habt schon sehr viele kommende Termine. Bitte meldet euch bei uns." }, { status: 429 });

  const result = await saveEvent({
    accountId: partner.accountId,
    actor: { by: "PARTNER", name: parsed.data.byName },
    input: parsed.data,
    partnerId: partner.id,
    partnerRules: { areaIds: partner.areaIds, horizonDays: partner.horizonDays },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  await notifyStaff(partner, result.event, "neuer Termin", request.nextUrl.origin);
  return NextResponse.json({ event: serializeEventForPartner(result.event, partner.editLockHours) }, { status: 201 });
}
