import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { berlinDayRange, berlinToday, summarizeBookings, type PreviewTicket } from "@/lib/day-preview";
import { getDayForecast } from "@/lib/weather-day";

export const dynamic = "force-dynamic";

/**
 * GET (Hub, Token-Auth): Tagesvorschau fuer den Hub-Assistenten.
 *
 *   ?date=YYYY-MM-DD   Berliner Kalendertag, Standard heute
 *
 * 200 { date, account, bookings: DayBookings, weather: DayForecast | null, generatedAt }
 *
 * Buchungen = Tagestickets, die an diesem Tag gelten (ANNY-Sync, Shop),
 * ohne Abos, Vereine, Mitarbeiter, Bulk-Baender, Pausierte und Stornierte.
 * Personendaten gehen nur als Nachname des Gruppenbuchers an den Hub.
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const accountId = auth.account.id;

  const param = request.nextUrl.searchParams.get("date");
  if (param && !/^\d{4}-\d{2}-\d{2}$/.test(param)) {
    return NextResponse.json({ error: "date muss YYYY-MM-DD sein" }, { status: 400 });
  }
  const date = param ?? berlinToday();
  const { start, end } = berlinDayRange(date);

  const [account, rows] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId }, select: { name: true, latitude: true, longitude: true } }),
    prisma.ticket.findMany({
      where: {
        accountId,
        status: { in: ["VALID", "REDEEMED", "PROTECTED"] },
        subscriptionId: null,
        vereinId: null,
        bulkBatchId: null,
        OR: [{ source: null }, { source: { not: "EMP_CONTROL" } }],
        startDate: { lt: end },
        AND: [{ OR: [{ endDate: { gte: start } }, { endDate: null, startDate: { gte: start } }] }],
      },
      select: {
        id: true,
        uuid: true,
        name: true,
        firstName: true,
        lastName: true,
        serviceId: true,
        ticketTypeName: true,
        validityType: true,
        slotStart: true,
        slotEnd: true,
        startDate: true,
        endDate: true,
        annyResourceId: true,
        annyOrderId: true,
        addOns: true,
        service: { select: { name: true } },
      },
      orderBy: { id: "asc" },
      take: 5000,
    }),
  ]);

  const tickets: PreviewTicket[] = rows.map(({ service, ...t }) => ({ ...t, serviceName: service?.name ?? null }));
  const weather = await getDayForecast(account?.latitude, account?.longitude, date);

  return NextResponse.json({
    date,
    account: account?.name ?? null,
    bookings: summarizeBookings(tickets),
    weather,
    generatedAt: new Date().toISOString(),
  });
}
