import type { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb, validateApiToken } from "@/lib/api-auth";
import { computeResourceUtilization, type ResourceUtilizationRow } from "@/lib/resource-utilization";
import {
  fetchAnnyAvailability,
  fmtTimeBerlin,
  periodsToSlots,
  type AnnyMapping,
  type AvailabilitySlot,
} from "@/lib/anny-availability";

function hasApiToken(request: NextRequest) {
  return request.nextUrl.searchParams.has("token") || !!request.headers.get("authorization")?.startsWith("Bearer ");
}

type EnrichedRow = ResourceUtilizationRow & {
  availability: AvailabilitySlot[];
  openingHours: string | null;
};

async function loadAnnyAvailability(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  accountId: number,
  dateStr: string,
  resources: ResourceUtilizationRow[],
): Promise<Map<number, AvailabilitySlot[]>> {
  const result = new Map<number, AvailabilitySlot[]>();
  try {
    const annyConfig = await db.apiConfig.findFirst({
      where: { accountId, provider: "ANNY" },
      select: { token: true, baseUrl: true, extraConfig: true },
    });
    if (!annyConfig?.token || !annyConfig.extraConfig) return result;

    const parsed: AnnyMapping = JSON.parse(annyConfig.extraConfig);
    const mappings = parsed.mappings ?? {};
    const resourceIds = parsed.resourceIds ?? {};

    const areaToAnnyIds = new Map<number, string[]>();
    for (const [name, areaId] of Object.entries(mappings)) {
      const rid = resourceIds[name];
      if (!rid) continue;
      if (!areaToAnnyIds.has(areaId)) areaToAnnyIds.set(areaId, []);
      const list = areaToAnnyIds.get(areaId)!;
      if (!list.includes(rid)) list.push(rid);
    }

    const allRids = [...new Set([...areaToAnnyIds.values()].flat())];
    if (allRids.length === 0) return result;

    const baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
    const availability = await fetchAnnyAvailability(baseUrl, annyConfig.token, allRids, dateStr);

    for (const row of resources) {
      const rids = areaToAnnyIds.get(row.resourceId);
      if (!rids) continue;
      const allPeriods = rids.flatMap((rid) => availability[rid] ?? []);
      if (allPeriods.length === 0) continue;
      result.set(row.resourceId, periodsToSlots(allPeriods));
    }
  } catch {
    /* ANNY nicht konfiguriert oder Fehler → ignorieren */
  }
  return result;
}

function enrichResources(
  resources: ResourceUtilizationRow[],
  availMap: Map<number, AvailabilitySlot[]>,
): EnrichedRow[] {
  return resources.map((r) => {
    const slots = availMap.get(r.resourceId) ?? [];
    const openingHours =
      slots.length > 0
        ? slots.map((s) => `${s.startTime}–${s.endTime}`).join(" · ")
        : null;
    return { ...r, availability: slots, openingHours };
  });
}

/**
 * Auslastung + ANNY-Verfügbarkeiten pro Ressource.
 *
 * Auth wie eigene API: Bearer-Token oder ?token= (Account apiToken), alternativ eingeloggte Session.
 *
 * GET /api/webhook/utilization?date=2026-03-22
 * Query: date (YYYY-MM-DD, optional, default heute), all=1 (auch Bereiche ohne Dashboard-Flag)
 */
export async function GET(request: NextRequest) {
  const dateParam = request.nextUrl.searchParams.get("date");
  const selectedDate = dateParam ? new Date(dateParam + "T12:00:00") : new Date();
  if (isNaN(selectedDate.getTime())) {
    return NextResponse.json({ error: "Ungültiges Datum (erwartet YYYY-MM-DD)" }, { status: 400 });
  }

  const dayStart = new Date(selectedDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(selectedDate);
  dayEnd.setHours(23, 59, 59, 999);

  const y = dayStart.getFullYear();
  const m = String(dayStart.getMonth() + 1).padStart(2, "0");
  const d = String(dayStart.getDate()).padStart(2, "0");
  const dateStr = `${y}-${m}-${d}`;

  const allResources = request.nextUrl.searchParams.get("all") === "1";
  const opts = { onlyShowOnDashboard: !allResources };

  if (hasApiToken(request)) {
    const auth = await validateApiToken(request);
    if ("error" in auth) return auth.error;
    const resources = await computeResourceUtilization(
      auth.db as unknown as PrismaClient,
      auth.account.id,
      dayStart,
      dayEnd,
      opts,
    );
    const availMap = await loadAnnyAvailability(auth.db, auth.account.id, dateStr, resources);
    return NextResponse.json({
      date: dateStr,
      resources: enrichResources(resources, availMap),
    });
  }

  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.isSuperAdmin) {
    return NextResponse.json(
      { error: "Super-Admin: bitte API-Token nutzen oder Account wählen" },
      { status: 400 },
    );
  }

  const resources = await computeResourceUtilization(
    session.db as unknown as PrismaClient,
    session.accountId!,
    dayStart,
    dayEnd,
    opts,
  );
  const availMap = await loadAnnyAvailability(session.db, session.accountId!, dateStr, resources);
  return NextResponse.json({
    date: dateStr,
    resources: enrichResources(resources, availMap),
  });
}
