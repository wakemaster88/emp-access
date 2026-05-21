import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  resolveAnnyOrganizationId,
  fetchAllAnnyServices,
  matchAnnyServiceInCatalog,
  fetchAnnyServiceStartSlots,
  berlinOffset,
  type AnnyServiceCatalogEntry,
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

interface ServiceOverview {
  serviceId: number;
  name: string;
  hasAnnyLink: boolean;
  serviceType: "slot" | "day";
  annyServiceUuid: string | null;
  annyMatchedName: string | null;
  slots: SlotEntry[];
  /** Aggregat: insgesamt EMP-Tickets dieses Service heute (ueber alle Slots). */
  totalEmpBookings: number;
  /** Wenn ANNY nicht gematcht: Hinweis fuer das UI. */
  note: string | null;
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

  // Wir interessieren uns NUR fuer Services mit ANNY-Link.
  const annyServices = services.filter((s) =>
    s.serviceAreas.some((sa) => (sa.area?._count.annyLinks ?? 0) > 0),
  );

  if (annyServices.length === 0 || !annyConfig?.token) {
    return NextResponse.json({
      date: dateStr,
      services: [],
      summary: emptySummary(),
    } satisfies OverviewResponse);
  }

  const baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
  const organizationId = await resolveAnnyOrganizationId(
    baseUrl,
    annyConfig.token,
    annyConfig.extraConfig,
  );

  // 2. ANNY-Service-Katalog einmal holen.
  let catalog: AnnyServiceCatalogEntry[] = [];
  try {
    catalog = await fetchAllAnnyServices(baseUrl, annyConfig.token, organizationId);
  } catch {
    catalog = [];
  }

  // 3. EMP-Tickets dieses Tages laden, fuer EMP-Booking-Zaehlung pro Slot.
  // Wir nehmen Tickets, deren `slotStart` gesetzt ist UND deren Tag dem
  // Anfragedatum entspricht. Fallback fuer Tickets ohne slotStart aber mit
  // startDate im Tag: ueber HH:MM extrahieren.
  const ticketsToday = await prisma.ticket.findMany({
    where: {
      accountId,
      status: { in: ["VALID", "REDEEMED"] },
      serviceId: { in: annyServices.map((s) => s.id) },
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

  // 4. Pro Service parallel die ANNY-Slots holen.
  const perService: ServiceOverview[] = await Promise.all(
    annyServices.map(async (svc) => {
      const annyNames = collectServiceNames(svc.name, svc.annyNames);
      const match = matchAnnyServiceInCatalog(catalog, annyNames);

      if (!match) {
        return {
          serviceId: svc.id,
          name: svc.name,
          hasAnnyLink: true,
          serviceType: "slot",
          annyServiceUuid: null,
          annyMatchedName: null,
          slots: [],
          totalEmpBookings: ticketsToday.filter((t) => t.serviceId === svc.id).length,
          note: `ANNY-Service nicht gefunden (gesucht: ${annyNames.slice(0, 3).join(", ")})`,
        } satisfies ServiceOverview;
      }

      const minDur = match.info.minDuration;
      const isDayService =
        match.info.isFullDay === true
        || (minDur != null && minDur >= 24 * 60)
        || match.info.autoDuration === true;
      const serviceType: "slot" | "day" = isDayService ? "day" : "slot";

      // Day-Pass: ANNY-Slots brauchen wir nicht abzurufen, das UI zeigt
      // nur die EMP-Ticket-Zahl an.
      if (serviceType === "day") {
        return {
          serviceId: svc.id,
          name: svc.name,
          hasAnnyLink: true,
          serviceType,
          annyServiceUuid: match.id,
          annyMatchedName: match.name,
          slots: [],
          totalEmpBookings: ticketsToday.filter((t) => t.serviceId === svc.id).length,
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

      return {
        serviceId: svc.id,
        name: svc.name,
        hasAnnyLink: true,
        serviceType,
        annyServiceUuid: match.id,
        annyMatchedName: match.name,
        slots,
        totalEmpBookings: ticketsToday.filter((t) => t.serviceId === svc.id).length,
        note: null,
      } satisfies ServiceOverview;
    }),
  );

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
