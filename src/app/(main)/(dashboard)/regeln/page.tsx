import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { ruleInclude } from "@/lib/room-rule-queries";
import { DEFAULT_TIMEZONE } from "@/lib/tz-time";
import { RegelnClient } from "@/components/regeln/regeln-client";
import type { RegelnData } from "@/components/regeln/types";

export const dynamic = "force-dynamic";

/**
 * Regeln: Ausloeser plus Bedingungen plus Aktionen, mit Raumbezug.
 * Loest die frueheren Shelly-Szenen und -Automationen ab.
 */
export default async function RegelnPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const accountId = session.user.accountId;
  const db = tenantClient(accountId);
  const byName = { orderBy: { name: "asc" as const }, select: { id: true, name: true } };

  const [rules, runs, rooms, devices, cameras, areas, schedules, audioZones, announcements, playlists, account] =
    await Promise.all([
      db.roomRule.findMany({
        where: { accountId },
        include: ruleInclude,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      db.roomRuleRun.findMany({
        where: { accountId },
        orderBy: { triggeredAt: "desc" },
        take: 60,
      }),
      db.keyRoom.findMany({ where: { accountId }, ...byName }),
      db.device.findMany({
        where: { accountId, isActive: true },
        select: { id: true, name: true, type: true, category: true },
        orderBy: { name: "asc" },
      }),
      db.camera.findMany({ where: { accountId }, ...byName }),
      db.accessArea.findMany({ where: { accountId }, ...byName }),
      db.operatingSchedule.findMany({ where: { accountId }, ...byName }),
      db.audioZone.findMany({ where: { accountId }, ...byName }),
      db.audioAnnouncement.findMany({ where: { accountId }, ...byName }),
      db.audioPlaylist.findMany({ where: { accountId }, ...byName }),
      db.account.findUnique({ where: { id: accountId }, select: { timezone: true } }),
    ]);

  const data: RegelnData = {
    // Prisma liefert Date-Objekte; die Client-Typen erwarten ISO-Strings.
    rules: JSON.parse(JSON.stringify(rules)),
    runs: JSON.parse(JSON.stringify(runs)),
    options: { rooms, devices, cameras, areas, schedules, audioZones, announcements, playlists },
    timezone: account?.timezone || DEFAULT_TIMEZONE,
    readonly: session.user.role === "USER",
    renderedAt: new Date().toISOString(),
  };

  return (
    <>
      <Header title="Regeln" accountName={session.user.accountName} />
      <RegelnClient data={data} />
    </>
  );
}
