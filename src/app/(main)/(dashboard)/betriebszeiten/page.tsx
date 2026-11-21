import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { scheduleInclude } from "@/lib/operating-queries";
import { DEFAULT_TIMEZONE } from "@/lib/tz-time";
import { BetriebszeitenClient } from "@/components/betriebszeiten/betriebszeiten-client";
import type { BetriebszeitenData } from "@/components/betriebszeiten/types";

export const dynamic = "force-dynamic";

/**
 * Betriebszeiten pflegen. Ein Profil je Betriebsteil (Strandbad, Gastronomie),
 * darin Saisons mit Wochenplan und einzelne Ausnahmetage. Raeume haengen an
 * einem Profil; die Regel-Engine fragt darueber, ob gerade geoeffnet ist.
 */
export default async function BetriebszeitenPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const accountId = session.user.accountId;
  const db = tenantClient(accountId);
  const now = new Date();

  const [schedules, account, roomsWithoutSchedule] = await Promise.all([
    db.operatingSchedule.findMany({
      where: { accountId },
      include: scheduleInclude,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.account.findUnique({ where: { id: accountId }, select: { timezone: true } }),
    db.keyRoom.count({ where: { accountId, operatingScheduleId: null } }),
  ]);

  const data: BetriebszeitenData = {
    schedules: schedules.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      isDefault: s.isDefault,
      sortOrder: s.sortOrder,
      roomCount: s._count.rooms,
      seasons: s.seasons.map((season) => ({
        name: season.name,
        startMmDd: season.startMmDd,
        endMmDd: season.endMmDd,
        sortOrder: season.sortOrder,
        periods: season.periods.map((p) => ({
          weekday: p.weekday,
          opensAt: p.opensAt,
          closesAt: p.closesAt,
        })),
      })),
      exceptions: s.exceptions.map((e) => ({
        date: e.date,
        closed: e.closed,
        opensAt: e.opensAt,
        closesAt: e.closesAt,
        note: e.note,
      })),
    })),
    timezone: account?.timezone || DEFAULT_TIMEZONE,
    renderedAt: now.toISOString(),
    roomsWithoutSchedule,
    readonly: session.user.role === "USER",
  };

  return (
    <>
      <Header title="Betriebszeiten" accountName={session.user.accountName} />
      <BetriebszeitenClient data={data} />
    </>
  );
}
