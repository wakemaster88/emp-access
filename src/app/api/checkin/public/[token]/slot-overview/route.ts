import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  resolveAnnyOrganizationId,
  fetchAllAnnyServices,
  fetchAllAnnyResources,
  matchAnnyServiceInCatalog,
  suggestAnnyServiceNames,
  fetchAnnyServiceStartSlots,
  fetchAnnyServiceStartDates,
  fetchAnnyServicePeriods,
  fetchAnnyResourcePeriods,
  applyLocalSalesOverrides,
  mergeAvailabilityPeriods,
  fmtTimeBerlin,
  berlinOffset,
  type AnnyServiceCatalogEntry,
  type AnnyResource,
} from "@/lib/anny-availability";

export const maxDuration = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface SlotEntry {
  startTime: string;
  endTime: string;
  startIso: string;
  endIso: string;
  available: boolean;
  capacity: number | null;
  remaining: number | null;
  empBookings: number;
  unavailabilityType: string | null;
}

interface OpeningHourBlock {
  start: string;
  end: string;
}

interface ServiceOverview {
  serviceId: number;
  name: string;
  hasAnnyLink: boolean;
  serviceType: "slot" | "day";
  annyServiceUuid: string | null;
  annyMatchedName: string | null;
  /**
   * Prim\u00e4re ANNY-Resource (z.B. "Seilbahn B"). Wird im UI zur Top-Level-
   * Gruppierung verwendet. Nimmt die ERSTE Resource aus
   * relationships.resources des ANNY-Service. null = entweder Service nicht
   * in ANNY oder ANNY liefert keine Resource (z.B. Day-Pass-Services wie
   * Strandbad).
   */
  primaryResource: { id: string; name: string } | null;
  slots: SlotEntry[];
  /** Aggregat: insgesamt EMP-Tickets dieses Service heute (ueber alle Slots). */
  totalEmpBookings: number;
  /**
   * Ist der Service an dem angefragten Datum ueberhaupt buchbar?
   * false = ANNY meldet keine Verfuegbarkeit (z.B. Ferienkurs erst im Juli,
   * Anfaengerkurs nur an Wochenenden). Wird im UI zum Ausblenden genutzt.
   * true bei Slot-Services mit Slots > 0; sonst per /start-dates abgefragt.
   */
  availableToday: boolean;
  /**
   * Oeffnungszeit aus ANNY /availability/periods, kompakt formatiert
   * ("HH:MM-HH:MM"). Mehrere Bloecke werden zu mehreren Eintraegen.
   * Leer wenn ANNY nichts liefert oder Service nicht ANNY-verknuepft.
   */
  openingHours: OpeningHourBlock[];
  /** Wenn ANNY nicht gematcht: Hinweis fuer das UI. */
  note: string | null;
  /**
   * Debug-Payload: rohe ANNY-Antwort fuer diesen Service. Nur gesetzt
   * wenn der Endpoint mit ?debug=1 aufgerufen wird. Dient zur
   * Diagnose, warum ANNY z.B. alle Slots als "voll" meldet
   * (unavailability_type, capacity, remaining usw.).
   */
  debug?: {
    rawAnnySlots: unknown[];
    rawAnnyPeriods?: unknown[];
  };
}

interface OverviewResponse {
  date: string;
  services: ServiceOverview[];
  summary: {
    totalSlots: number;
    freeSlots: number;
    partialSlots: number;
    fullSlots: number;
    totalCapacity: number;
    totalRemaining: number;
    totalEmpBookings: number;
  };
}

/**
 * Aggregiert fuer das Shop-Monitor-Dashboard die Slot-Auslastung aller
 * ANNY-verknuepften Services an einem Tag. Liefert pro Service eine
 * Slot-Liste mit ANNY-Kapazitaet + ANNY-Restplaetzen + lokalen EMP-Tickets
 * (gezaehlt anhand `slotStart`), plus eine Gesamt-Zusammenfassung fuer den
 * Header-Counter.
 *
 * Performance:
 *   - Holt ANNY-Services EINMAL und matched alle EMP-Services lokal
 *     (verhindert N Pagination-Loops gegen ANNY).
 *   - Holt /availability/start fuer alle gemachten Services parallel.
 *
 * Caching: 15s s-maxage + SWR, da das Dashboard alle paar Sekunden pollt
 * und wir nicht ANNY mit jedem Poll bombardieren wollen.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const dateStr = request.nextUrl.searchParams.get("date") ?? "";
  if (!DATE_RE.test(dateStr)) {
    return NextResponse.json({ error: "Ungueltiges Datum (YYYY-MM-DD)" }, { status: 400 });
  }
  // Mit ?debug=1 reichen wir die rohen ANNY-Slot-Antworten pro Service
  // durch. Praktisch um zu pruefen, warum z.B. ein Service "voll"
  // angezeigt wird (unavailabilityType / capacity / remaining).
  const debug = request.nextUrl.searchParams.get("debug") === "1";
  const accountId = monitor.accountId;

  const tz = berlinOffset(dateStr);
  const dayStart = new Date(`${dateStr}T00:00:00${tz}`);
  const dayEnd = new Date(`${dateStr}T23:59:59${tz}`);

  // 1. ANNY-Konfig + alle Services mit potentiellem ANNY-Link laden.
  const [annyConfig, services] = await Promise.all([
    prisma.apiConfig.findFirst({
      where: { accountId, provider: "ANNY" },
      select: { token: true, baseUrl: true, extraConfig: true },
    }),
    prisma.service.findMany({
      where: { accountId },
      select: {
        id: true,
        name: true,
        annyNames: true,
        defaultValidityDurationMinutes: true,
        serviceAreas: {
          select: {
            area: { select: { _count: { select: { annyLinks: true } } } },
          },
        },
      },
    }),
  ]);

  // Wir betrachten zwei Service-Gruppen:
  //   1. ANNY-verknuepfte Services (haben AccessArea mit annyLink) -
  //      vollstaendige Auslastungssicht mit Slots, Periods, Verfuegbarkeit.
  //   2. EMP-Services OHNE ANNY-Link, aber heute mit verkauften Tickets -
  //      reine Ticket-Zaehler-Sicht. Sonst verschwinden Services wie
  //      Aquapark / SUP, wenn sie nicht in ANNY verknuepft sind.
  const annyServices = services.filter((s) =>
    s.serviceAreas.some((sa) => (sa.area?._count.annyLinks ?? 0) > 0),
  );
  const annyServiceIds = new Set(annyServices.map((s) => s.id));
  const nonAnnyServices = services.filter((s) => !annyServiceIds.has(s.id));

  if (annyServices.length === 0 && nonAnnyServices.length === 0) {
    return NextResponse.json({
      date: dateStr,
      services: [],
      summary: emptySummary(),
    } satisfies OverviewResponse);
  }

  // ANNY-Calls nur, wenn Token vorhanden und ANNY-verknuepfte Services
  // existieren. Sonst springen wir direkt zur reinen EMP-Sicht.
  const baseUrl = annyConfig?.token
    ? (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "")
    : "";
  const organizationId = annyConfig?.token
    ? await resolveAnnyOrganizationId(baseUrl, annyConfig.token, annyConfig.extraConfig)
    : null;

  // 2. ANNY-Service-Katalog + Resource-Katalog parallel holen.
  let catalog: AnnyServiceCatalogEntry[] = [];
  let resources: AnnyResource[] = [];
  if (annyConfig?.token && annyServices.length > 0) {
    try {
      [catalog, resources] = await Promise.all([
        fetchAllAnnyServices(baseUrl, annyConfig.token, organizationId),
        fetchAllAnnyResources(baseUrl, annyConfig.token, organizationId).catch(() => []),
      ]);
    } catch {
      catalog = [];
      resources = [];
    }
  }
  const resourceById = new Map<string, AnnyResource>();
  for (const r of resources) resourceById.set(r.id, r);

  // 3. EMP-Tickets dieses Tages laden, fuer EMP-Booking-Zaehlung pro Slot.
  // Wir nehmen Tickets, deren `slotStart` gesetzt ist UND deren Tag dem
  // Anfragedatum entspricht. Fallback fuer Tickets ohne slotStart aber mit
  // startDate im Tag: ueber HH:MM extrahieren. Filter ueber alle Services
  // (ANNY-verknuepfte UND nicht-verknuepfte), damit Aquapark / SUP / etc.
  // ueber EMP-Tickets ihren Weg in die Auslastungssicht finden.
  const ticketsToday = await prisma.ticket.findMany({
    where: {
      accountId,
      status: { in: ["VALID", "REDEEMED"] },
      serviceId: { in: services.map((s) => s.id) },
      OR: [
        // Slot-basiertes Ticket: Tag muss innerhalb startDate/endDate liegen.
        {
          slotStart: { not: null },
          startDate: { lte: dayEnd },
          endDate: { gte: dayStart },
        },
        // Day-Pass: kein slotStart, aber Datum am Tag.
        {
          slotStart: null,
          startDate: { gte: dayStart, lte: dayEnd },
        },
      ],
    },
    select: {
      id: true,
      serviceId: true,
      slotStart: true,
      slotEnd: true,
      startDate: true,
    },
  });

  // Helper: extrahiert primaere Resource aus einem Catalog-Match (entweder
  // direkt aus match.resourceIds[0] oder aus den geladenen Slots als
  // Fallback fuer Tenants, deren Service-Endpoint keine Resources mit
  // ausliefert).
  const resolvePrimaryResource = (
    catalogResourceIds: string[] | undefined,
    slotResourceIds: string[] | undefined,
  ): { id: string; name: string } | null => {
    const candidates = (catalogResourceIds && catalogResourceIds.length > 0
      ? catalogResourceIds
      : slotResourceIds) ?? [];
    for (const id of candidates) {
      const r = resourceById.get(id);
      if (r) return { id: r.id, name: r.name };
    }
    return null;
  };

  // 4. Pro Service parallel die ANNY-Slots holen.
  const perService: ServiceOverview[] = await Promise.all(
    annyServices.map(async (svc) => {
      const empCount = ticketsToday.filter((t) => t.serviceId === svc.id).length;
      const annyNames = collectServiceNames(svc.name, svc.annyNames);
      const match = matchAnnyServiceInCatalog(catalog, annyNames);

      if (!match) {
        // Diagnose: liste ANNY-Services mit aehnlichen Tokens auf, damit
        // der Mitarbeiter sieht, welche annyNames im Backoffice gepflegt
        // werden muessten.
        const suggestions = suggestAnnyServiceNames(catalog, annyNames, 6);
        const suggestionText =
          suggestions.length > 0
            ? ` ANNY-Vorschlaege: ${suggestions.join(", ")}.`
            : "";
        return {
          serviceId: svc.id,
          name: svc.name,
          hasAnnyLink: true,
          serviceType: "slot",
          annyServiceUuid: null,
          annyMatchedName: null,
          primaryResource: null,
          slots: [],
          totalEmpBookings: empCount,
          // Wenn ANNY den Service nicht kennt, koennen wir Verfuegbarkeit
          // nicht beurteilen - lieber anzeigen mit Hinweis als verstecken.
          availableToday: true,
          openingHours: [],
          note:
            `ANNY-Service nicht gefunden (gesucht: ${annyNames.slice(0, 3).join(", ")}).`
            + suggestionText,
        } satisfies ServiceOverview;
      }

      const minDur = match.info.minDuration;
      const isDayService =
        match.info.isFullDay === true
        || (minDur != null && minDur >= 24 * 60)
        || match.info.autoDuration === true;
      const serviceType: "slot" | "day" = isDayService ? "day" : "slot";

      // Day-Pass: ANNY-Slots brauchen wir nicht abzurufen, das UI zeigt
      // nur die EMP-Ticket-Zahl an. Aber wir wollen
      //  a) wissen, ob der Service heute ueberhaupt verfuegbar ist
      //     (Ferienkurs erst im Juli etc.) - dafuer /start-dates
      //  b) die Oeffnungszeiten anzeigen (10:00-18:00 etc.) - dafuer
      //     /availability/periods
      //
      // Oeffnungszeiten: zuerst service-basiert (das ist die ANNY-
      // autoritative Service-Verfuegbarkeit incl. Service-Schedule, z.B.
      // "Strandbad-Tageskarte erst ab 12:00 buchbar" obwohl die Resource
      // "Strandbad" schon ab 10:00 offen ist). Erst wenn der Service-
      // Endpoint keine Periods liefert (passiert bei Services ohne
      // explizite Service-Schedule), fallback auf die Resource-Periods
      // ueber ?r[]=<resourceId>. So bekommen wir bei korrekt gepflegten
      // ANNY-Services die echten Service-Zeiten und bei Tenants ohne
      // Service-Schedule trotzdem sinnvolle Werte.
      if (serviceType === "day") {
        const hasResources = match.resourceIds.length > 0;
        const [datesRes, servicePeriods] = await Promise.all([
          fetchAnnyServiceStartDates(
            baseUrl,
            annyConfig!.token,
            match.id,
            dateStr,
            dateStr,
            organizationId,
          ).catch(() => [] as string[]),
          fetchAnnyServicePeriods(
            baseUrl,
            annyConfig!.token,
            match.id,
            dateStr,
            organizationId,
          ).catch(() => []),
        ]);
        let periodsRes = servicePeriods;
        if (periodsRes.length === 0 && hasResources) {
          periodsRes = await fetchAnnyResourcePeriods(
            baseUrl,
            annyConfig!.token,
            match.resourceIds,
            dateStr,
          ).catch(() => []);
        }
        // /start-dates ist die autoritative Quelle fuer "ist dieser Day-Pass-
        // Service an diesem Datum buchbar?" (Ferienkurs erst im Juli etc.).
        // Leeres Array = heute nicht buchbar. Frueher haben wir bei leerem
        // Ergebnis faelschlich `true` angenommen - das hat saisonale Services
        // mit Resource-Oeffnungszeiten (10-20) trotzdem angezeigt.
        const availableToday = datesRes.some((d) => d.startsWith(dateStr));
        const merged = availableToday
          ? mergeAvailabilityPeriods(periodsRes)
          : [];
        const openingHours: OpeningHourBlock[] = merged.map((p) => ({
          start: fmtTimeBerlin(p.start),
          end: fmtTimeBerlin(p.end),
        }));
        return {
          serviceId: svc.id,
          name: svc.name,
          hasAnnyLink: true,
          serviceType,
          annyServiceUuid: match.id,
          annyMatchedName: match.name,
          // Day-Pass-Services haben in ANNY oft KEINE Resource (Strandbad,
          // Aquapark etc.) - dann bleibt das null und sie landen im UI in
          // der Sonstige-Gruppe.
          primaryResource: resolvePrimaryResource(match.resourceIds, undefined),
          slots: [],
          totalEmpBookings: empCount,
          availableToday,
          openingHours,
          note: null,
        } satisfies ServiceOverview;
      }

      const slotDurationMin = match.info.minDuration ?? match.info.bookingInterval ?? null;
      let rawSlots: Awaited<ReturnType<typeof fetchAnnyServiceStartSlots>> = [];
      try {
        rawSlots = await fetchAnnyServiceStartSlots(
          baseUrl,
          annyConfig!.token,
          match.id,
          dateStr,
          {
            organizationId,
            slotDurationMinutes: slotDurationMin,
          },
        );
      } catch {
        rawSlots = [];
      }

      // Vor-Ort-Verkaufs-Overrides: Lead-Time ignorieren + ANNY-Quirks
      // fuer Services ohne hinterlegte Resource-Kapazitaet ausblenden.
      // Siehe applyLocalSalesOverrides in @/lib/anny-availability.
      rawSlots = applyLocalSalesOverrides(rawSlots);

      // EMP-Buchungen pro Slot: anhand `slotStart` (HH:MM) gruppieren.
      const empByStart = new Map<string, number>();
      for (const t of ticketsToday) {
        if (t.serviceId !== svc.id) continue;
        const key = normalizeSlotKey(t);
        if (!key) continue;
        empByStart.set(key, (empByStart.get(key) ?? 0) + 1);
      }

      const slots: SlotEntry[] = rawSlots
        .filter((s) => s.startTime)
        .map((s) => ({
          startTime: s.startTime,
          endTime: s.endTime,
          startIso: s.startIso,
          endIso: s.endIso,
          available: s.available,
          capacity: typeof s.capacity === "number" ? s.capacity : null,
          remaining: typeof s.remaining === "number" ? s.remaining : null,
          empBookings: empByStart.get(s.startTime) ?? 0,
          unavailabilityType: s.unavailabilityType ?? null,
        }));

      // Verfuegbarkeit: wenn /availability/start Slots geliefert hat, ist
      // der Service heute aktiv. Sonst per /start-dates verifizieren -
      // koennte ausgebucht oder schlicht nicht im Saison-Zeitraum sein.
      let availableToday = slots.length > 0;
      if (!availableToday) {
        try {
          const dates = await fetchAnnyServiceStartDates(
            baseUrl,
            annyConfig!.token,
            match.id,
            dateStr,
            dateStr,
            organizationId,
          );
          availableToday = dates.some((d) => d.startsWith(dateStr));
        } catch {
          availableToday = false;
        }
      }

      // Fallback fuer Resource-Lookup: wenn der Service-Endpoint keine
      // Resources auslieferte, ziehen wir sie aus den Slots (jeder Slot
      // bringt resource_ids mit).
      const slotResourceIds: string[] = [];
      for (const s of rawSlots) {
        if (Array.isArray(s.resourceIds)) {
          for (const rid of s.resourceIds) {
            if (!slotResourceIds.includes(rid)) slotResourceIds.push(rid);
          }
        }
      }

      return {
        serviceId: svc.id,
        name: svc.name,
        hasAnnyLink: true,
        serviceType,
        annyServiceUuid: match.id,
        annyMatchedName: match.name,
        primaryResource: resolvePrimaryResource(match.resourceIds, slotResourceIds),
        slots,
        totalEmpBookings: empCount,
        availableToday,
        // Slot-Services: Oeffnungszeiten ergeben sich aus den Slots selbst
        // (z.B. 12:00-13:00, 14:00-15:00). Eine zusaetzliche periods-Anzeige
        // wuerde nur Doppelinformation sein.
        openingHours: [],
        note: null,
        ...(debug ? { debug: { rawAnnySlots: rawSlots } } : {}),
      } satisfies ServiceOverview;
    }),
  );

  // Nicht-ANNY-Services mit heutigen EMP-Tickets ergaenzen (Aquapark / SUP
  // etc., die in EMP existieren aber nicht ueber ANNY laufen). Ohne
  // verkaufte Tickets klappen sie wegen `availableToday`-Filter ohnehin im
  // Frontend aus - mit Tickets bleiben sie sichtbar als reine EMP-Sicht.
  for (const svc of nonAnnyServices) {
    const empCount = ticketsToday.filter((t) => t.serviceId === svc.id).length;
    if (empCount === 0) continue;
    perService.push({
      serviceId: svc.id,
      name: svc.name,
      hasAnnyLink: false,
      // Default als "day" - wir haben keinen ANNY-Service-Typ, und Aquapark
      // / SUP etc. sind im Regelfall keine zeitscheibengenauen Slots.
      serviceType: "day",
      annyServiceUuid: null,
      annyMatchedName: null,
      primaryResource: null,
      slots: [],
      totalEmpBookings: empCount,
      availableToday: true,
      openingHours: [],
      note: "Kein ANNY-Sync",
    });
  }

  // 5. Aggregat-Summary ueber alle Slot-Services.
  let totalSlots = 0;
  let freeSlots = 0;
  let partialSlots = 0;
  let fullSlots = 0;
  let totalCapacity = 0;
  let totalRemaining = 0;
  let totalEmpBookings = 0;
  for (const sv of perService) {
    totalEmpBookings += sv.totalEmpBookings;
    if (sv.serviceType !== "slot") continue;
    for (const slot of sv.slots) {
      totalSlots++;
      if (typeof slot.capacity === "number") totalCapacity += slot.capacity;
      if (typeof slot.remaining === "number") totalRemaining += slot.remaining;
      const blocked = !slot.available || (slot.remaining != null && slot.remaining <= 0);
      if (blocked) {
        fullSlots++;
      } else if (
        slot.remaining != null
        && slot.capacity != null
        && slot.remaining < slot.capacity
      ) {
        partialSlots++;
      } else {
        freeSlots++;
      }
    }
  }

  const body: OverviewResponse = {
    date: dateStr,
    services: perService,
    summary: {
      totalSlots,
      freeSlots,
      partialSlots,
      fullSlots,
      totalCapacity,
      totalRemaining,
      totalEmpBookings,
    },
  };

  return NextResponse.json(body, {
    headers: {
      // 15s Cache-Time fuer Dashboard-Polling. ANNY's Daten aendern sich
      // bei jedem Verkauf, deshalb stale-while-revalidate kurz halten.
      "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30",
    },
  });
}

function emptySummary(): OverviewResponse["summary"] {
  return {
    totalSlots: 0,
    freeSlots: 0,
    partialSlots: 0,
    fullSlots: 0,
    totalCapacity: 0,
    totalRemaining: 0,
    totalEmpBookings: 0,
  };
}

/**
 * Erzeugt aus dem EMP-Service-Namen + annyNames-JSON eine Suchliste fuer
 * den ANNY-Katalog. Identisch zur Strategie im /slots-Endpoint.
 */
function collectServiceNames(empName: string, annyNamesJson: string | null): string[] {
  const names: string[] = [];
  if (annyNamesJson) {
    try {
      const parsed = JSON.parse(annyNamesJson);
      if (Array.isArray(parsed)) {
        for (const n of parsed) if (typeof n === "string" && n.trim()) names.push(n.trim());
      }
    } catch { /* ignore */ }
  }
  if (empName) {
    names.push(empName);
    const parts = empName.split(/\s[-–]\s/);
    if (parts.length > 1) {
      for (const p of parts) {
        const t = p.trim();
        if (t) names.push(t);
      }
    }
  }
  return Array.from(new Set(names));
}

/**
 * Normalisiert die Slot-Start-Zeit eines Tickets zu "HH:MM", damit wir
 * gegen ANNY's startTime gruppieren koennen. Fallback ueber startDate-Uhrzeit.
 */
function normalizeSlotKey(t: {
  slotStart: string | null;
  startDate: Date | null;
}): string | null {
  if (t.slotStart) {
    // Format ist "HH:MM" oder "HH:MM:SS" - auf "HH:MM" trimmen.
    return t.slotStart.slice(0, 5);
  }
  if (t.startDate) {
    const d = t.startDate;
    // In Berlin-Zeitzone formatieren, dann HH:MM nehmen.
    const hhmm = d.toLocaleTimeString("de-DE", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
    });
    return hhmm;
  }
  return null;
}
