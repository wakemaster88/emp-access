import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addCalendarDays, berlinYmd } from "@/lib/berlin-day";
import { activeAccessBooking, loadPortalAccessPoints, loadPortalVerein } from "@/lib/verein-portal";
import { accessWindow, bookingWindow, canVereinCancel } from "@/lib/verein-portal-rules";

export const dynamic = "force-dynamic";

/**
 * Vereinsportal: Stammdaten, buchbare Services und eigene Buchungen
 * (kommende plus die letzten 90 Tage). Oeffentlich, Zugang nur ueber den
 * geheimen Link.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verein = await loadPortalVerein(token);
  if (!verein) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const today = berlinYmd(new Date());
  const bookings = await prisma.vereinSlotBooking.findMany({
    where: { accountId: verein.accountId, vereinId: verein.id, date: { gte: addCalendarDays(today, -90) } },
    orderBy: [{ date: "asc" }, { slotStart: "asc" }],
    select: {
      id: true,
      serviceName: true,
      date: true,
      slotStart: true,
      slotEnd: true,
      startDate: true,
      endDate: true,
      priceCents: true,
      status: true,
      bookedBy: true,
      note: true,
      canceledBy: true,
      rejectReason: true,
      billedAt: true,
    },
  });

  const [points, active] = await Promise.all([loadPortalAccessPoints(verein), activeAccessBooking(verein)]);
  const now = Date.now();
  const lead = verein.portalLeadMinutes;
  const trail = verein.portalTrailMinutes;
  // Naechstes Zugangsfenster (laufend oder kommend), damit das Portal sagt,
  // ab wann die Tueren aufgehen.
  const nextBooking = active ?? bookings.find((b) => b.status === "BOOKED" && b.endDate.getTime() + trail * 60_000 > now);
  const nextWindow = nextBooking ? accessWindow(nextBooking.startDate, nextBooking.endDate, lead, trail) : null;

  return NextResponse.json({
    access: {
      points,
      leadMinutes: lead,
      trailMinutes: trail,
      active: !!active,
      window: nextWindow ? { from: nextWindow.from.toISOString(), to: nextWindow.to.toISOString() } : null,
    },
    verein: {
      name: verein.name,
      accountName: verein.account.name,
      cancelHours: verein.portalCancelHours,
      horizonDays: verein.portalHorizonDays,
      window: bookingWindow(verein.portalHorizonDays),
    },
    services: verein.bookableServices.map((s) => ({ id: s.serviceId, name: s.service.name, priceCents: s.priceCents })),
    bookings: bookings.map((b) => ({
      id: b.id,
      serviceName: b.serviceName,
      date: b.date,
      slotStart: b.slotStart,
      slotEnd: b.slotEnd,
      priceCents: b.priceCents,
      status: b.status,
      bookedBy: b.bookedBy,
      note: b.note,
      canceledBy: b.canceledBy,
      rejectReason: b.rejectReason,
      billed: !!b.billedAt,
      past: b.endDate.getTime() <= Date.now(),
      canCancel:
        (b.status === "REQUESTED" && b.startDate.getTime() > Date.now())
        || (b.status === "BOOKED" && !b.billedAt && canVereinCancel(b.startDate, verein.portalCancelHours)),
    })),
  });
}
