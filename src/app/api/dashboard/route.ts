import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId, isSuperAdmin } = session;
  const where = isSuperAdmin ? {} : { accountId: accountId! };

  const dateParam = request.nextUrl.searchParams.get("date");
  const selectedDate = dateParam ? new Date(dateParam + "T00:00:00") : new Date();
  if (isNaN(selectedDate.getTime())) {
    return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
  }

  const dayStart = new Date(selectedDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(selectedDate);
  dayEnd.setHours(23, 59, 59, 999);

  const [areas, scansToday, unassignedTickets] = await Promise.all([
    db.accessArea.findMany({
      where,
      select: {
        id: true,
        name: true,
        personLimit: true,
        allowReentry: true,
        tickets: {
          where: {
            status: { in: ["VALID", "REDEEMED"] },
            OR: [
              { startDate: null, endDate: null },
              { startDate: { lte: dayEnd }, endDate: null },
              { startDate: null, endDate: { gte: dayStart } },
              { startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
            ],
          },
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            ticketTypeName: true,
            status: true,
            startDate: true,
            endDate: true,
            validityType: true,
            slotStart: true,
            slotEnd: true,
            validityDurationMinutes: true,
            firstScanAt: true,
            profileImage: true,
            source: true,
          },
          orderBy: { name: "asc" },
        },
        _count: {
          select: {
            tickets: {
              where: {
                status: { in: ["VALID", "REDEEMED"] },
                OR: [
                  { startDate: null, endDate: null },
                  { startDate: { lte: dayEnd }, endDate: null },
                  { startDate: null, endDate: { gte: dayStart } },
                  { startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
                ],
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.scan.count({
      where: { ...where, scanTime: { gte: dayStart, lte: dayEnd } },
    }),
    db.ticket.findMany({
      where: {
        ...where,
        accessAreaId: null,
        status: { in: ["VALID", "REDEEMED"] },
        OR: [
          { startDate: null, endDate: null },
          { startDate: { lte: dayEnd }, endDate: null },
          { startDate: null, endDate: { gte: dayStart } },
          { startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
        ],
      },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        ticketTypeName: true,
        status: true,
        startDate: true,
        endDate: true,
        validityType: true,
        slotStart: true,
        slotEnd: true,
        validityDurationMinutes: true,
        firstScanAt: true,
        profileImage: true,
        source: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return NextResponse.json({
    date: dayStart.toISOString().split("T")[0],
    scansToday,
    areas,
    unassigned: {
      id: null,
      name: "Ohne Bereich",
      personLimit: null,
      allowReentry: false,
      tickets: unassignedTickets,
      _count: { tickets: unassignedTickets.length },
    },
  });
}
