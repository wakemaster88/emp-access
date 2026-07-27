/**
 * Ist-Zustand aller Zonen für die Live-Anzeige im Dashboard.
 *
 * Bewusst schlank gehalten: Die Seite fragt das im Sekundentakt-Bereich ab,
 * ein voller `router.refresh()` würde dafür alle sieben Abfragen der Seite
 * erneut ausführen.
 */
import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { isPlayerOnline } from "@/lib/audio";

/** So viele Einträge braucht die Verlaufsliste, um „gerade passiert" zu zeigen. */
const RECENT_JOBS = 50;

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;

  const [zones, jobs, pending] = await Promise.all([
    db.audioZone.findMany({
      where: { accountId: accountId! },
      select: {
        id: true,
        isActive: true,
        isPlaying: true,
        currentTitle: true,
        volume: true,
        reportedVolume: true,
        lastStateAt: true,
        device: { select: { lastUpdate: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.audioJob.findMany({
      where: { accountId: accountId! },
      select: {
        id: true,
        kind: true,
        status: true,
        triggerKind: true,
        errorMessage: true,
        createdAt: true,
        zone: { select: { name: true } },
        announcement: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: RECENT_JOBS,
    }),
    // Offene Befehle nur zählen. `groupBy` ist mit dem Tenant-Client nicht
    // typisierbar, und im Normalbetrieb stehen hier ohnehin nur wenige Einträge.
    db.audioJob.findMany({
      where: { accountId: accountId!, status: { in: ["PENDING", "SENT"] } },
      select: { zoneId: true },
      take: 500,
    }),
  ]);

  const pendingByZone = new Map<number, number>();
  for (const job of pending) {
    pendingByZone.set(job.zoneId, (pendingByZone.get(job.zoneId) ?? 0) + 1);
  }

  return NextResponse.json({
    zones: zones.map((zone) => ({
      id: zone.id,
      isActive: zone.isActive,
      isPlaying: zone.isPlaying,
      currentTitle: zone.currentTitle,
      volume: zone.volume,
      reportedVolume: zone.reportedVolume,
      deviceOnline: isPlayerOnline(zone.device?.lastUpdate),
      lastStateAt: zone.lastStateAt?.toISOString() ?? null,
      pendingJobs: pendingByZone.get(zone.id) ?? 0,
    })),
    jobs: jobs.map((job) => ({
      id: job.id,
      zoneName: job.zone.name,
      kind: job.kind,
      status: job.status,
      triggerKind: job.triggerKind,
      announcementName: job.announcement?.name ?? null,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
    })),
  });
}
