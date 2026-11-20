import { redirect } from "next/navigation";
import { safeAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/header";
import { isTenantAdminRole } from "@/lib/api-auth";
import { VenueSettings } from "@/components/veranstaltungen/venue-settings";
import { VeranstaltungenTabs } from "@/components/veranstaltungen/veranstaltungen-tabs";
import type { VenueExtraUnit } from "@/lib/venue-event-rules";

export const dynamic = "force-dynamic";

/** Einstellungen der Veranstaltungen: Räume, Zusatzleistungen, Partner-Zugänge (nur Admins). */
export default async function VeranstaltungenEinstellungenPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId || !isTenantAdminRole(session.user.role)) redirect("/veranstaltungen");
  const accountId = session.user.accountId;

  const [areas, extras, partners] = await Promise.all([
    prisma.accessArea.findMany({
      where: { accountId },
      select: { id: true, name: true, eventVenue: true, eventBufferMinutes: true, eventCapacity: true },
      orderBy: { name: "asc" },
    }),
    prisma.venueExtra.findMany({
      where: { accountId },
      select: { id: true, areaId: true, name: true, description: true, priceCents: true, unit: true, active: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.eventPartner.findMany({
      where: { accountId },
      select: {
        id: true, name: true, contactName: true, logoUrl: true, contactEmail: true, notifyEmail: true, portalToken: true,
        portalEnabled: true, areaIds: true, editLockHours: true, horizonDays: true, _count: { select: { events: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <Header title="Veranstaltungen" accountName={session.user.accountName} />
      <div className="page-content space-y-4">
        <VeranstaltungenTabs value="einstellungen" isAdmin />
        <VenueSettings
          areas={areas}
          extras={extras.map((x) => ({ ...x, unit: x.unit as VenueExtraUnit }))}
          partners={partners.map(({ _count, ...p }) => ({ ...p, eventCount: _count.events }))}
        />
      </div>
    </>
  );
}
