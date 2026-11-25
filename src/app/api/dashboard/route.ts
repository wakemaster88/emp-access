import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  fetchAnnyAvailability,
  fmtTimeBerlin as fmtTime,
  type AvailabilityPeriod,
} from "@/lib/anny-availability";
import { berlinDayRange, berlinYmd, isBerlinYmd } from "@/lib/berlin-day";
import { photoServable, ticketPhotoUrl, wantsPhotoUrls, withPhotoRef } from "@/lib/photo-url";
import { ticketIdsWithPhoto } from "@/lib/ticket-photo";

function getBookingTimeForDate(qrCode: string | null, dateStr: string): { start: string; end: string } | null {
  if (!qrCode) return null;
  try {
    const entries = JSON.parse(qrCode);
    if (!Array.isArray(entries)) return null;
    for (const entry of entries) {
      if (entry.start && entry.start.includes(dateStr)) {
        return {
          start: fmtTime(entry.start),
          end: entry.end ? fmtTime(entry.end) : "",
        };
      }
    }
  } catch { /* not JSON */ }
  return null;
}

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId, isSuperAdmin } = session;
  const where = isSuperAdmin ? {} : { accountId: accountId! };

  const dateParam = request.nextUrl.searchParams.get("date");
  const dateStr = dateParam && isBerlinYmd(dateParam) ? dateParam : berlinYmd(new Date());
  if (dateParam && !isBerlinYmd(dateParam)) {
    return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
  }

  // Halboffen [start, endExclusive): auf Vercel ist die Runtime UTC, darum
  // nicht setHours(0) auf einem lokalen Date.
  const { start: dayStart, endExclusive } = berlinDayRange(dateStr);
  const dayEnd = new Date(endExclusive.getTime() - 1);

  const dayActiveFilter = {
    status: { in: ["VALID", "REDEEMED"] as ("VALID" | "REDEEMED")[] },
    OR: [
      { startDate: { lte: dayEnd }, endDate: null },
      { startDate: null, endDate: { gte: dayStart } },
      { startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
    ],
  };

  const areaTicketDateFilter = {
    ...dayActiveFilter,
    subscriptionId: null,
    serviceId: null,
  };

  // `?fotos=url` (neuer Client): kein Base64-Foto, dafuer hasPhoto und
  // photoUrl. Ohne den Parameter bleibt die Antwort wie bisher.
  const photoUrls = wantsPhotoUrls(request.nextUrl.searchParams);

  const ticketSelect = {
    id: true,
    name: true,
    firstName: true,
    lastName: true,
    ticketTypeName: true,
    status: true,
    startDate: true,
    endDate: true,
    validityType: true,
    slotStart: true,
    slotEnd: true,
    validityDurationMinutes: true,
    firstScanAt: true,
    profileImage: !photoUrls,
    updatedAt: photoUrls,
    source: true,
    qrCode: true,
    barcode: true,
    rfidCode: true,
  };

  // Abo-Besuch und Check-in: ein erlaubter Scan an diesem Tag.
  const grantedOnDay = { some: { scanTime: { gte: dayStart, lt: endExclusive }, result: "GRANTED" as const } };

  const [areas, unassignedTickets, visitedSubscriptions, activeSubscriptions, serviceTickets, annyConfig, checkedInToday, newTicketsToday, newTicketSources] = await Promise.all([
    db.accessArea.findMany({
      where: { ...where, showOnDashboard: true },
      select: {
        id: true,
        name: true,
        personLimit: true,
        allowReentry: true,
        openingHours: true,
        tickets: {
          where: areaTicketDateFilter,
          select: ticketSelect,
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.ticket.findMany({
      where: { ...where, accessAreaId: null, subscriptionId: null, serviceId: null, ...dayActiveFilter },
      select: ticketSelect,
      orderBy: { name: "asc" },
    }),
    // Abos: nur die, die an diesem Tag da waren – alle aktiven stehen unter „Abos“.
    db.ticket.findMany({
      where: { ...where, subscriptionId: { not: null }, scans: grantedOnDay },
      select: {
        ...ticketSelect,
        subscription: { select: { name: true, requiresPhoto: true, requiresRfid: true } },
      },
      orderBy: [{ subscription: { name: "asc" } }, { name: "asc" }],
    }),
    db.ticket.count({
      where: { ...where, subscriptionId: { not: null }, ...dayActiveFilter },
    }),
    // Services (Stundenkarten, Kurse …): an diesem Tag benutzt oder angelegt.
    // Ohne diese Grenze stünden alle unbefristeten Karten jeden Tag hier.
    db.ticket.findMany({
      where: {
        ...where,
        serviceId: { not: null },
        OR: [{ createdAt: { gte: dayStart, lt: endExclusive } }, { scans: grantedOnDay }],
      },
      select: {
        ...ticketSelect,
        service: { select: { name: true, requiresPhoto: true, requiresRfid: true } },
      },
      orderBy: [{ service: { name: "asc" } }, { name: "asc" }],
    }),
    db.apiConfig.findFirst({
      where: { ...(isSuperAdmin ? {} : { accountId: accountId! }), provider: "ANNY" },
      select: { token: true, baseUrl: true, extraConfig: true, lastUpdate: true },
    }),
    db.scan.findMany({
      where: { ...where, scanTime: { gte: dayStart, lt: endExclusive }, result: "GRANTED", ticketId: { not: null } },
      select: { ticketId: true },
      distinct: ["ticketId"],
    }),
    db.ticket.findMany({
      where: { ...where, createdAt: { gte: dayStart, lt: endExclusive } },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        ticketTypeName: true,
        profileImage: !photoUrls,
        updatedAt: photoUrls,
        source: true,
        createdAt: true,
        subscription: { select: { name: true } },
        service: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.ticket.findMany({
      where: { ...where, createdAt: { gte: dayStart, lt: endExclusive } },
      select: { source: true },
    }),
  ]);

  const checkedInIds = new Set(checkedInToday.map((s) => s.ticketId!));

  // Foto-Kennzeichen über eine schlanke ID-Abfrage statt über das Bild.
  const photoIds = photoUrls
    ? await ticketIdsWithPhoto(db, [
        ...areas.flatMap((a) => a.tickets.map((t) => t.id)),
        ...unassignedTickets.map((t) => t.id),
        ...visitedSubscriptions.map((t) => t.id),
        ...serviceTickets.map((t) => t.id),
        ...newTicketsToday.map((t) => t.id),
      ])
    : null;

  const annyLinks = await db.annyResourceLink.findMany({
    where: { accountId: accountId! },
  });

  let annyAvailability: Record<string, AvailabilityPeriod[]> = {};
  const allResIds = [...new Set(annyLinks.map((l) => l.annyResourceId))];

  if (annyConfig?.token && allResIds.length > 0) {
    try {
      const baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
      annyAvailability = await fetchAnnyAvailability(baseUrl, annyConfig.token, allResIds, dateStr);
    } catch { /* ignore */ }
  }

  const areaResourceMap: Record<number, { name: string; resourceId: string }[]> = {};
  const areaAllNames: Record<number, string[]> = {};
  for (const link of annyLinks) {
    if (!areaAllNames[link.accessAreaId]) areaAllNames[link.accessAreaId] = [];
    areaAllNames[link.accessAreaId].push(link.annyName);

    if (!areaResourceMap[link.accessAreaId]) areaResourceMap[link.accessAreaId] = [];
    const exists = areaResourceMap[link.accessAreaId].some((r) => r.resourceId === link.annyResourceId);
    if (!exists) areaResourceMap[link.accessAreaId].push({ name: link.annyName, resourceId: link.annyResourceId });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function enrichTicket(ticket: any) {
    const bt = ticket.source === "ANNY" ? getBookingTimeForDate(ticket.qrCode, dateStr) : null;
    const hasRfid = !!ticket.rfidCode;
    const hasPhoto = photoIds ? photoIds.has(ticket.id) : !!ticket.profileImage;
    const needsRfid = !hasRfid && (!!ticket.service?.requiresRfid || !!ticket.subscription?.requiresRfid);
    const needsPhoto = !hasPhoto && (!!ticket.service?.requiresPhoto || !!ticket.subscription?.requiresPhoto);
    const groupName = ticket.subscription?.name || ticket.service?.name || null;
    const { qrCode: _, barcode: _b, rfidCode: _r, service: _s, subscription: _sub, ...rest } = ticket;
    return {
      ...(photoIds ? withPhotoRef(rest, photoIds, ticketPhotoUrl) : rest),
      bookingStart: bt?.start || null,
      bookingEnd: bt?.end || null,
      hasRfid,
      needsRfid,
      needsPhoto,
      groupName,
      checkedIn: checkedInIds.has(ticket.id),
    };
  }

  function ticketMatchesResource(ticketTypeName: string | null, resourceName: string): boolean {
    if (!ticketTypeName) return false;
    return ticketTypeName.startsWith(resourceName);
  }

  // Only keep tickets that actually belong to the selected day:
  // - skip employee tickets entirely
  // - for ANNY tickets, require a booking entry in the qrCode JSON for dateStr
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function isDayTicket(t: any): boolean {
    if (t.source === "EMP_CONTROL") return false;
    if (t.source === "ANNY") return getBookingTimeForDate(t.qrCode, dateStr) !== null;
    return true;
  }

  // Build structured area responses
  const structuredAreas = areas.map((area) => {
    const areaResources = areaResourceMap[area.id] || [];
    const directTickets = area.tickets.filter(isDayTicket).map(enrichTicket);
    const totalCount = directTickets.length;
    // Transit-Zonen wie Insel haben weder Limit noch ANNY-Slots – die
    // Belegungslaisten wuerden sie dauerhaft als "ruhig" zeigen.
    const occupancyRelevant = area.personLimit != null || (areaAllNames[area.id] || []).length > 0;

    if (areaResources.length === 0) {
      let computedHours = area.openingHours;
      if (!computedHours) {
        const areaRids = [...new Set(
          annyLinks.filter((l) => l.accessAreaId === area.id).map((l) => l.annyResourceId),
        )];
        const slotSet = new Set<string>();
        for (const rid of areaRids) {
          if (annyAvailability[rid]) {
            for (const p of annyAvailability[rid]) {
              const s = fmtTime(p.start), e = fmtTime(p.end);
              if (s && e) slotSet.add(`${s}–${e}`);
            }
          }
        }
        if (slotSet.size > 0) computedHours = [...slotSet].sort().join(" · ");
      }
      return {
        id: area.id,
        name: area.name,
        personLimit: area.personLimit,
        allowReentry: area.allowReentry,
        openingHours: computedHours,
        resources: [],
        otherTickets: directTickets,
        occupancyRelevant,
        _count: { tickets: totalCount },
      };
    }

    // Deduplicate resources by resourceId
    const seenResIds = new Set<string>();
    const uniqueResources = areaResources.filter((r) => {
      if (seenResIds.has(r.resourceId)) return false;
      seenResIds.add(r.resourceId);
      return true;
    });

    const matched = new Set<number>();
    const resources = uniqueResources
      .map((res) => {
        const periods = annyAvailability[res.resourceId] || [];
        const seenSlots = new Set<string>();
        const slots = periods
          .map((p) => ({ startTime: fmtTime(p.start), endTime: fmtTime(p.end) }))
          .filter((s) => {
            if (!s.startTime || !s.endTime) return false;
            const key = `${s.startTime}-${s.endTime}`;
            if (seenSlots.has(key)) return false;
            seenSlots.add(key);
            return true;
          })
          .sort((a, b) => a.startTime.localeCompare(b.startTime));

        const namesForArea = areaAllNames[area.id] || [];
        const resTickets = directTickets.filter((t) => {
          if (matched.has(t.id)) return false;
          for (const name of namesForArea) {
            if (ticketMatchesResource(t.ticketTypeName, name)) {
              matched.add(t.id);
              return true;
            }
          }
          return false;
        });

        return { resourceName: res.name, slots, tickets: resTickets };
      })
      .sort((a, b) => {
        const aTime = a.slots[0]?.startTime || "99:99";
        const bTime = b.slots[0]?.startTime || "99:99";
        return aTime.localeCompare(bTime);
      });

    const otherTickets = directTickets.filter((t) => !matched.has(t.id));

    function namesMatch(resName: string, areaName: string): boolean {
      const rLow = resName.toLowerCase();
      const aLow = areaName.toLowerCase();
      return rLow === aLow || rLow.includes(aLow) || aLow.includes(rLow);
    }

    // Single resource matching area name → merge time into header
    if (resources.length === 1 && namesMatch(resources[0].resourceName, area.name)) {
      const r = resources[0];
      const uniqueSlotStrs = [...new Set(r.slots.map((s) => `${s.startTime}–${s.endTime}`))];
      const inlineHours = uniqueSlotStrs.length > 0
        ? uniqueSlotStrs.join(" · ")
        : area.openingHours;
      return {
        id: area.id,
        name: area.name,
        personLimit: area.personLimit,
        allowReentry: area.allowReentry,
        openingHours: inlineHours,
        resources: [],
        otherTickets: [...r.tickets, ...otherTickets],
        occupancyRelevant,
        _count: { tickets: totalCount },
      };
    }

    // Multiple resources → find primary (name matches area), promote its time to header
    const primaryIdx = resources.findIndex((r) => namesMatch(r.resourceName, area.name));
    if (primaryIdx >= 0) {
      const primary = resources[primaryIdx];
      const rest = resources.filter((_, i) => i !== primaryIdx);
      const uniqueSlotStrs = [...new Set(primary.slots.map((s) => `${s.startTime}–${s.endTime}`))];
      const inlineHours = uniqueSlotStrs.length > 0
        ? uniqueSlotStrs.join(" · ")
        : area.openingHours;
      return {
        id: area.id,
        name: area.name,
        personLimit: area.personLimit,
        allowReentry: area.allowReentry,
        openingHours: inlineHours,
        resources: rest,
        otherTickets: [...primary.tickets, ...otherTickets],
        occupancyRelevant,
        _count: { tickets: totalCount },
      };
    }

    return {
      id: area.id,
      name: area.name,
      personLimit: area.personLimit,
      allowReentry: area.allowReentry,
      openingHours: area.openingHours,
      resources,
      otherTickets,
      occupancyRelevant,
      _count: { tickets: totalCount },
    };
  });

  const filteredUnassigned = unassignedTickets.filter(isDayTicket).map(enrichTicket);
  const enrichedSubscriptions = visitedSubscriptions.map(enrichTicket);
  const enrichedServices = serviceTickets.map(enrichTicket);

  // Kennzahlen der Buchungen: nur Tagesbuchungen (Bereiche + ohne Bereich),
  // eingecheckt = davon mit erlaubtem Scan an diesem Tag. Früher zählte
  // „Eingecheckt“ alle Scans inkl. Abos und lag weit über 100 %.
  const dayTickets = [...structuredAreas.flatMap((a) => [...a.resources.flatMap((r) => r.tickets), ...a.otherTickets]), ...filteredUnassigned];
  const booked = dayTickets.length;
  const bookedCheckedIn = dayTickets.filter((t) => t.checkedIn).length;
  const newTicketsAnny = newTicketSources.filter((t) => t.source === "ANNY").length;

  let annySyncStatus: { lastSync: string | null; created?: number; updated?: number; errors?: number; errorDetails?: string[]; total?: number } | null = null;
  if (annyConfig) {
    try {
      const extra = annyConfig.extraConfig ? JSON.parse(annyConfig.extraConfig) : {};
      const sr = extra.lastSyncResult;
      annySyncStatus = {
        lastSync: sr?.at || annyConfig.lastUpdate?.toISOString() || null,
        created: sr?.created,
        updated: sr?.updated,
        errors: sr?.errors,
        errorDetails: sr?.errorDetails,
        total: sr?.total,
      };
    } catch {
      annySyncStatus = { lastSync: annyConfig.lastUpdate?.toISOString() || null };
    }
  }

  return NextResponse.json({
    date: dateStr,
    kpis: {
      booked,
      bookedCheckedIn,
      subscriptionsVisited: enrichedSubscriptions.length,
      subscriptionsActive: activeSubscriptions,
      newTickets: newTicketSources.length,
      newTicketsAnny,
    },
    annySyncStatus,
    newTickets: newTicketsToday.map((t) => {
      const base = {
        id: t.id,
        name: [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name,
        typeName: t.subscription?.name || t.service?.name || t.ticketTypeName || null,
        source: t.source,
      };
      if (photoIds) {
        const hasPhoto = photoIds.has(t.id);
        return { ...base, hasPhoto, photoUrl: photoServable(photoIds, t.id) ? ticketPhotoUrl(t.id, t.updatedAt) : null, createdAt: t.createdAt };
      }
      return { ...base, profileImage: t.profileImage, createdAt: t.createdAt };
    }),
    areas: structuredAreas,
    unassigned: {
      id: null,
      name: "Ohne Resource",
      personLimit: null,
      allowReentry: false,
      openingHours: null,
      resources: [],
      otherTickets: filteredUnassigned,
      occupancyRelevant: filteredUnassigned.length > 0,
      _count: { tickets: filteredUnassigned.length },
    },
    subscriptions: enrichedSubscriptions,
    services: enrichedServices,
  });
}
