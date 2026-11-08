import { redirect } from "next/navigation";
import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { berlinYmd } from "@/lib/berlin-day";
import { monthBounds } from "@/lib/verein-portal-rules";
import { Header } from "@/components/layout/header";
import { Notice } from "@/components/ui/notice";
import { VereineTabs } from "@/components/vereine/vereine-tabs";
import { VereinPortalsCard } from "@/components/vereine/verein-portals-card";
import { VereinBookingsCard } from "@/components/vereine/verein-bookings-card";
import { VereinRequestsCard } from "@/components/vereine/verein-requests-card";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ monat?: string; verein?: string }>;
}

/**
 * Vereinsbuchungen: Portale der Vereine einrichten und die gebuchten Slots
 * monatsweise abrechnen (Summen, CSV, als abgerechnet markieren).
 */
export default async function VereinsBuchungenPage({ searchParams }: PageProps) {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  const accountId = session.user.accountId;
  if (!accountId) {
    return (
      <>
        <Header title="Vereine" accountName={session.user.accountName} />
        <div className="page-content">
          <Notice tone="neutral" title="Vereinsbuchungen gibt es nur innerhalb eines Mandanten." />
        </div>
      </>
    );
  }

  const sp = await searchParams;
  const month = monthBounds(sp.monat ?? "") ? sp.monat! : berlinYmd(new Date()).slice(0, 7);
  const bounds = monthBounds(month)!;
  const vereinFilter = Number(sp.verein);
  const vereinId = Number.isInteger(vereinFilter) && vereinFilter > 0 ? vereinFilter : null;

  const db = tenantClient(accountId);
  const now = new Date();
  const [vereine, bookings, openCount, requests] = await Promise.all([
    db.verein.findMany({
      where: { accountId },
      select: {
        id: true,
        name: true,
        portalEnabled: true,
        portalToken: true,
        _count: { select: { bookableServices: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.vereinSlotBooking.findMany({
      where: {
        accountId,
        date: { gte: bounds.from, lte: bounds.to },
        status: { in: ["BOOKED", "CANCELED"] },
        ...(vereinId ? { vereinId } : {}),
      },
      include: { verein: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { slotStart: "asc" }],
    }),
    db.vereinSlotBooking.count({ where: { accountId, status: "BOOKED", billedAt: null, endDate: { lt: now } } }),
    db.vereinSlotBooking.findMany({
      where: { accountId, status: "REQUESTED", endDate: { gt: now } },
      include: { verein: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { slotStart: "asc" }],
      take: 100,
    }),
  ]);

  return (
    <>
      <Header title="Vereine" accountName={session.user.accountName} />
      <div className="page-content space-y-4 sm:space-y-5">
        <VereineTabs value="buchungen" openCount={openCount + requests.length} />
        <VereinRequestsCard
          rows={requests.map((r) => ({
            id: r.id,
            vereinName: r.verein.name,
            serviceName: r.serviceName,
            date: r.date,
            slotStart: r.slotStart,
            slotEnd: r.slotEnd,
            priceCents: r.priceCents,
            bookedBy: r.bookedBy,
            note: r.note,
          }))}
        />
        <VereinBookingsCard
          month={month}
          vereinId={vereinId}
          vereine={vereine.map((v) => ({ id: v.id, name: v.name }))}
          rows={bookings.map((b) => ({
            id: b.id,
            vereinName: b.verein.name,
            serviceName: b.serviceName,
            date: b.date,
            slotStart: b.slotStart,
            slotEnd: b.slotEnd,
            priceCents: b.priceCents,
            status: b.status as "BOOKED" | "CANCELED",
            bookedBy: b.bookedBy,
            note: b.note,
            canceledBy: b.canceledBy,
            billedAt: b.billedAt ? b.billedAt.toISOString() : null,
            invoiceRef: b.invoiceRef,
            past: b.endDate.getTime() <= now.getTime(),
          }))}
        />
        <VereinPortalsCard
          vereine={vereine.map((v) => ({
            id: v.id,
            name: v.name,
            enabled: v.portalEnabled && !!v.portalToken,
            serviceCount: v._count.bookableServices,
          }))}
        />
      </div>
    </>
  );
}
