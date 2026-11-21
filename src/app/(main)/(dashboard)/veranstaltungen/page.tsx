import { redirect } from "next/navigation";
import { safeAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/header";
import { isTenantAdminRole } from "@/lib/api-auth";
import { addCalendarDays, berlinYmd } from "@/lib/berlin-day";
import { eventInclude, loadVenues, serializeEventForAdmin } from "@/lib/venue-events";
import { VenueEventsBoard } from "@/components/veranstaltungen/venue-events-board";
import { VeranstaltungenTabs } from "@/components/veranstaltungen/veranstaltungen-tabs";
import type { VenueExtraUnit } from "@/lib/venue-event-rules";

export const dynamic = "force-dynamic";

/**
 * Veranstaltungen: Belegung der Veranstaltungsräume (z. B. Rooftop Lounge).
 * Externe Partner tragen über ihren Link selbst ein; hier sieht das
 * Team alles, lädt Dokumente aus DATEV hoch und rechnet ab.
 */
export default async function VeranstaltungenPage({ searchParams }: { searchParams: Promise<{ termin?: string }> }) {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");
  const accountId = session.user.accountId;
  const isAdmin = isTenantAdminRole(session.user.role);
  const today = berlinYmd(new Date());

  const [venues, partners, extras, events] = await Promise.all([
    loadVenues(accountId),
    prisma.eventPartner.findMany({ where: { accountId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.venueExtra.findMany({
      where: { accountId },
      select: { id: true, areaId: true, name: true, description: true, priceCents: true, unit: true, active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.venueEvent.findMany({
      where: { accountId, date: { gte: addCalendarDays(today, -180) } },
      include: eventInclude,
      orderBy: { startDate: "asc" },
      take: 1000,
    }),
  ]);
  const openId = Number((await searchParams).termin) || null;

  return (
    <>
      <Header title="Veranstaltungen" accountName={session.user.accountName} />
      <div className="page-content space-y-4">
        <VeranstaltungenTabs value="termine" isAdmin={isAdmin} />
        <VenueEventsBoard
          venues={venues.map((v) => ({ id: v.id, name: v.name, bufferMinutes: v.eventBufferMinutes, capacity: v.eventCapacity }))}
          partners={partners}
          extras={extras.map((x) => ({ ...x, unit: x.unit as VenueExtraUnit }))}
          events={events.map(serializeEventForAdmin)}
          isAdmin={isAdmin}
          openId={openId}
          today={today}
        />
      </div>
    </>
  );
}
