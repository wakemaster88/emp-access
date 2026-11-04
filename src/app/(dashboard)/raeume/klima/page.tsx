import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { KlimaClient, type KlimaRoom } from "@/components/raeume/klima-client";
import { safeAuth } from "@/lib/auth";
import { superAdminClient, tenantClient, type TenantDb } from "@/lib/prisma";
import { DEFAULT_TIMEZONE } from "@/lib/tz-time";

export const dynamic = "force-dynamic";

/**
 * Auswertung › Klima: Temperatur- und Feuchteverlauf aller Räume mit Fühler.
 * Räume zählen, wenn sie eine Klimaregelung, einen aktiven Fühler oder schon
 * Messpunkte haben.
 */
export default async function KlimaPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db: TenantDb = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  const [rooms, account] = await Promise.all([
    db.keyRoom.findMany({
      where: {
        ...accountFilter,
        OR: [
          { climate: { isNot: null } },
          { devices: { some: { category: "SENSOR", isActive: true } } },
          { climateSamples: { some: {} } },
        ],
      },
      select: {
        id: true,
        name: true,
        building: true,
        floor: true,
        climate: {
          select: {
            isActive: true,
            targetC: true,
            currentTargetC: true,
            heating: true,
            fanOn: true,
            lastTempC: true,
            lastHumidity: true,
            lastError: true,
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    session.user.accountId ? db.account.findUnique({ where: { id: session.user.accountId }, select: { timezone: true } }) : null,
  ]);

  const list: KlimaRoom[] = rooms.map((r) => ({
    id: r.id,
    name: r.name,
    location: [r.building, r.floor].filter(Boolean).join(" · ") || null,
    climate: r.climate,
  }));

  return (
    <>
      <Header title="Klima" accountName={session.user.accountName} />
      <div className="page-content page-ambient flex-1">
        <KlimaClient rooms={list} timezone={account?.timezone || DEFAULT_TIMEZONE} renderedAt={new Date().toISOString()} />
      </div>
    </>
  );
}
