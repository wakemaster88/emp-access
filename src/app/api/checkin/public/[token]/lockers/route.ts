import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/// Aktuelles Vermietungsjahr in Berlin-Zeit (Default-Zone der App).
function currentYearBerlin(): number {
  const fmt = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" });
  const y = Number(fmt.format(new Date()));
  return Number.isFinite(y) ? y : new Date().getFullYear();
}

/// Liste aller Schließfächer für einen Checkin-Monitor inklusive der
/// Vermietung des aktuellen Jahres (= aktueller Mieter) und ein paar
/// Stamm-Infos zum Mieter-Ticket. Optional ?withHistory=1 für Historie.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { isActive: true, type: true, accountId: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const withHistory = request.nextUrl.searchParams.get("withHistory") === "1";
  const year = currentYearBerlin();

  const [lockers, aboTickets] = await Promise.all([
    prisma.locker.findMany({
      where: { accountId: monitor.accountId },
      include: {
        rentals: {
          where: withHistory ? undefined : { year },
          include: {
            ticket: {
              select: {
                id: true,
                name: true,
                firstName: true,
                lastName: true,
                ticketTypeName: true,
                status: true,
                endDate: true,
                profileImage: true,
                subscription: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { year: "desc" },
        },
      },
      orderBy: [{ location: "asc" }, { number: "asc" }],
    }),
    /// Mieter-Pool: alle Abo-Tickets mit gültigem Status, kompakt für die Auswahl.
    prisma.ticket.findMany({
      where: {
        accountId: monitor.accountId,
        subscriptionId: { not: null },
        status: { in: ["VALID", "REDEEMED", "PAUSED"] },
      },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        ticketTypeName: true,
        status: true,
        endDate: true,
        profileImage: true,
        subscription: { select: { id: true, name: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { name: "asc" }],
      take: 1000,
    }),
  ]);

  const data = lockers.map((l) => ({
    id: l.id,
    name: l.name,
    number: l.number,
    location: l.location,
    notes: l.notes,
    lockType: l.lockType,
    keyCount: l.keyCount,
    lockNumber: l.lockNumber,
    rentals: l.rentals.map((r) => ({
      id: r.id,
      year: r.year,
      ticketId: r.ticketId,
      keysIssued: r.keysIssued,
      keysReturned: r.keysReturned,
      issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
      returnedAt: r.returnedAt ? r.returnedAt.toISOString() : null,
      notes: r.notes,
      ticket: {
        id: r.ticket.id,
        name: r.ticket.name,
        firstName: r.ticket.firstName,
        lastName: r.ticket.lastName,
        ticketTypeName: r.ticket.ticketTypeName,
        status: r.ticket.status,
        endDate: r.ticket.endDate ? r.ticket.endDate.toISOString() : null,
        profileImage: r.ticket.profileImage,
        subscription: r.ticket.subscription,
      },
    })),
  }));

  const tickets = aboTickets.map((t) => ({
    id: t.id,
    name: t.name,
    firstName: t.firstName,
    lastName: t.lastName,
    ticketTypeName: t.ticketTypeName,
    status: t.status,
    endDate: t.endDate ? t.endDate.toISOString() : null,
    profileImage: t.profileImage,
    subscription: t.subscription,
  }));

  return NextResponse.json({ year, lockers: data, tickets });
}
