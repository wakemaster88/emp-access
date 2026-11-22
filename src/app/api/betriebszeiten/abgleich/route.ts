import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { scheduleSpecInclude, toScheduleSpec } from "@/lib/operating-queries";
import { buildSyncReport } from "@/lib/opening-sync";
import { DEFAULT_TIMEZONE } from "@/lib/tz-time";

export const dynamic = "force-dynamic";

/**
 * Die Website-Datenbank gehört zu genau einem Mandanten (Tuttenbrocksee).
 * Andere Mandanten sehen die Website-Spalte als „nicht verbunden“.
 */
function websiteUrlFor(accountId: number): string | null {
  const url = process.env.WEBSITE_DATABASE_URL;
  if (!url) return null;
  return Number(process.env.WEBSITE_ACCOUNT_ID || 1) === accountId ? url : null;
}

/** Abgleich der Betriebszeiten mit anny und der Website (nur lesen). */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }
  const { db, accountId } = session;

  const [schedules, account, annyConfig, links] = await Promise.all([
    db.operatingSchedule.findMany({
      where: { accountId },
      include: scheduleSpecInclude,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.account.findUnique({ where: { id: accountId }, select: { timezone: true } }),
    db.apiConfig.findFirst({ where: { accountId, provider: "ANNY" }, select: { token: true, baseUrl: true } }),
    db.annyResourceLink.findMany({
      where: { accountId },
      select: { annyResourceId: true, isPublic: true, accessArea: { select: { name: true } } },
    }),
  ]);

  const report = await buildSyncReport({
    schedules: schedules.map((s) => ({
      id: s.id,
      name: s.name,
      spec: toScheduleSpec(s),
      parentId: s.parentId,
      annyResourceId: s.annyResourceId,
    })),
    timezone: account?.timezone || DEFAULT_TIMEZONE,
    anny: annyConfig?.token
      ? { baseUrl: (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, ""), token: annyConfig.token }
      : null,
    links: links.map((l) => ({ annyResourceId: l.annyResourceId, isPublic: l.isPublic, areaName: l.accessArea.name })),
    websiteUrl: websiteUrlFor(accountId),
  });
  return NextResponse.json(report);
}
