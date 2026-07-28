import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  resolveAnnyOrganizationId,
  fetchAnnyServiceMatch,
  fetchAnnyServiceStartSlots,
  applyLocalSalesOverrides,
  resolveServiceResourceId,
  berlinOffset,
  type AvailabilitySlot,
} from "@/lib/anny-availability";
import {
  fetchAnnyResourceDayUsage,
  applyOwnSlotCapacity,
} from "@/lib/anny-slot-usage";

export const maxDuration = 15;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Holt fuer einen Service an einem konkreten Datum die buchbaren Slots aus
 * ANNY. Workflow:
 *   1. Service in unserer DB laden -> annyNames (Liste von ANNY-Service-Namen).
 *   2. ANNY-Service-UUID(s) via /api/v1/services?... aufloesen (Name -> UUID).
 *   3. /api/v1/availability/start?service_id=<uuid>&date=<YYYY-MM-DD> abfragen.
 *      Das ist laut Anny-Doku der einzige Endpoint, der echte buchbare
 *      Start-Intervalle fuer einen Service liefert (z.B. "Anfaengerkurs
 *      12:00 / 14:00 / 16:00"). /availability/periods waere die Oeffnungs-
 *      zeit der Resource und damit hier ungeeignet (Liefert die 10-18-Uhr
 *      Lift-Range, kein Kurs-Slot).
 *
 * Antwortet absichtlich auch dann mit 200, wenn ANNY nichts liefert oder
 * keine Verknuepfung existiert - der Client zeigt dann einen Fallback
 * (manuelle datetime-local-Eingabe).
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

  const serviceIdRaw = request.nextUrl.searchParams.get("serviceId");
  const dateStr = request.nextUrl.searchParams.get("date") ?? "";
  const serviceId = Number(serviceIdRaw);
  if (!Number.isFinite(serviceId) || serviceId <= 0) {
    return NextResponse.json({ error: "Ungueltige serviceId" }, { status: 400 });
  }
  if (!DATE_RE.test(dateStr)) {
    return NextResponse.json({ error: "Ungueltiges Datum (YYYY-MM-DD)" }, { status: 400 });
  }

  const accountId = monitor.accountId;

  const service = await prisma.service.findFirst({
    where: { id: serviceId, accountId },
    select: {
      id: true,
      name: true,
      annyNames: true,
      defaultValidityDurationMinutes: true,
      slotCapacity: true,
      serviceAreas: {
        select: { area: { select: { annyLinks: { select: { annyResourceId: true } } } } },
      },
    },
  });
  if (!service) {
    return NextResponse.json({ error: "Service nicht gefunden" }, { status: 404 });
  }

  // ANNY-Service-Namen extrahieren. `annyNames` ist ein JSON-Array von
  // Strings (z.B. ["Anfaengerkurs"]). Fallback: Service-Name selbst.
  const annyNames: string[] = [];
  if (service.annyNames) {
    try {
      const parsed = JSON.parse(service.annyNames);
      if (Array.isArray(parsed)) {
        for (const n of parsed) if (typeof n === "string" && n.trim()) annyNames.push(n.trim());
      }
    } catch { /* ignore, fallback below */ }
  }
  if (service.name) {
    annyNames.push(service.name);
    // Wenn der DB-Service-Name ein " - "-Suffix hat (z.B. "Anfaengerkurs -
    // Uebungslift"), heisst der ANNY-Service oft nur "Anfaengerkurs" oder
    // umgekehrt nur "Uebungslift". Beide Varianten zusaetzlich probieren.
    const parts = service.name.split(/\s[-–]\s/);
    if (parts.length > 1) {
      for (const p of parts) {
        const trimmed = p.trim();
        if (trimmed) annyNames.push(trimmed);
      }
    }
  }
  // Deduplizieren ohne Reihenfolge zu zerstoeren (frueher = bevorzugt).
  const uniqueNames = Array.from(new Set(annyNames));

  if (uniqueNames.length === 0) {
    return NextResponse.json({
      slots: [] as AvailabilitySlot[],
      hasAnnyLink: false,
      resourceCount: 0,
    });
  }

  const annyConfig = await prisma.apiConfig.findFirst({
    where: { accountId, provider: "ANNY" },
    select: { token: true, baseUrl: true, extraConfig: true },
  });
  if (!annyConfig?.token) {
    return NextResponse.json({
      slots: [] as AvailabilitySlot[],
      hasAnnyLink: true,
      resourceCount: 0,
      note: "ANNY nicht konfiguriert",
    });
  }

  const baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
  const organizationId = await resolveAnnyOrganizationId(
    baseUrl,
    annyConfig.token,
    annyConfig.extraConfig,
  );

  const debug = request.nextUrl.searchParams.get("debug") === "1";

  const match = await fetchAnnyServiceMatch(
    baseUrl,
    annyConfig.token,
    uniqueNames,
    organizationId,
  );
  if (!match.id) {
    // hasAnnyLink bleibt true: der Service IST mit ANNY verknuepft, wir
    // konnten nur die Service-UUID per Name nicht aufloesen. Das UI zeigt
    // damit den Note-Hinweis statt stumm zum datetime-local-Fallback zu
    // springen.
    const preview = match.knownNames.slice(0, 6).join(", ");
    const more = match.knownNames.length > 6 ? `, +${match.knownNames.length - 6} weitere` : "";
    const debugSummary = match.debug
      .map((d) => `p${d.page}:${d.status}/${d.items}${d.bodyPreview ? ` [${d.bodyPreview.replace(/\s+/g, " ").slice(0, 120)}]` : ""}`)
      .join(" | ");
    const orgInfo = organizationId ? ` org=${organizationId.slice(0, 8)}…` : " (keine Org-ID)";
    return NextResponse.json({
      slots: [] as AvailabilitySlot[],
      hasAnnyLink: true,
      resourceCount: 0,
      note:
        match.knownNames.length === 0
          ? `ANNY's /services lieferte 0 Eintraege.${orgInfo} ${debugSummary}`
          : `ANNY-Service nicht gefunden. Gesucht: "${uniqueNames.join('", "')}". ANNY kennt: ${preview}${more}.`,
      triedNames: uniqueNames,
      annyServiceNames: match.knownNames,
      ...(debug ? { debugMatch: match.debug, baseUrl, organizationId } : {}),
    });
  }
  const annyServiceUuid = match.id;

  // Bei Services, die mehrere Resources bedienen (z.B. "Exklusive Bahnmiete"
  // auf Seilbahn A UND B), die korrekte physische Resource fuer DIESEN
  // EMP-Service bestimmen (Schnittmenge EMP-Resources ∩ ANNY-Service-
  // Resources). So liefert der Picker fuer "Bahnmiete B" nur B-Slots.
  const serviceLinkedResourceIds = service.serviceAreas
    .flatMap((sa) => sa.area?.annyLinks ?? [])
    .map((l) => l.annyResourceId)
    .filter((x): x is string => !!x);
  const targetResourceId = resolveServiceResourceId(
    serviceLinkedResourceIds,
    match.resourceIds ?? [],
  );

  // Service-Typ aus ANNY-Properties ableiten. Tageskarten / Full-Day-
  // Services brauchen keinen Slot-Picker - dort waehlt der Mitarbeiter
  // nur das Datum.
  const minDur = match.serviceInfo?.minDuration ?? null;
  const isDayService =
    match.serviceInfo?.isFullDay === true ||
    (minDur != null && minDur >= 24 * 60) ||
    match.serviceInfo?.autoDuration === true;
  const serviceType: "slot" | "day" = isDayService ? "day" : "slot";

  if (serviceType === "day") {
    // Tagespass: keine Slots im UI anzeigen, nur Datum. Wir geben das
    // Service-Type-Signal mit, damit das Frontend die richtige UI-Variante
    // rendert.
    return NextResponse.json({
      slots: [] as AvailabilitySlot[],
      hasAnnyLink: true,
      resourceCount: 1,
      serviceType,
      annyServiceUuid,
    });
  }

  // Slot-Dauer aus dem ANNY-Service ableiten:
  //   * min_duration ist die kanonische Buchungsdauer fuer fixed-duration
  //     Services (z.B. "Anfaengerkurs 60 min").
  //   * Bei flexible Services nehmen wir min_duration als Default. Wir
  //     duerfen das nur als End-Zeit-Berechnung verwenden - wenn wir das
  //     an /availability/start mitgeben, beeinflusst es die Verfuegbarkeit.
  // duration wird BEWUSST NICHT an /availability/start gesendet (siehe
  // commit-Message): das veraendert sonst die remaining_number_available.
  const annyMinDurationMin = match.serviceInfo?.minDuration ?? null;
  const annyBookingIntervalMin = match.serviceInfo?.bookingInterval ?? null;

  let rawSlots: Awaited<ReturnType<typeof fetchAnnyServiceStartSlots>> = [];
  try {
    rawSlots = await fetchAnnyServiceStartSlots(
      baseUrl,
      annyConfig.token,
      annyServiceUuid,
      dateStr,
      {
        organizationId,
        // slotDurationMinutes wird NUR zur End-Zeit-Berechnung verwendet,
        // NICHT als duration-Filter an die API gesendet.
        slotDurationMinutes: annyMinDurationMin || annyBookingIntervalMin || null,
        ...(targetResourceId ? { resourceId: targetResourceId } : {}),
      },
    );
  } catch {
    return NextResponse.json({
      slots: [] as AvailabilitySlot[],
      hasAnnyLink: true,
      resourceCount: 0,
      error: "ANNY nicht erreichbar",
    });
  }

  // Vor-Ort-Verkaufs-Overrides: Lead-Time ignorieren, ANNY-Quirks fuer
  // unkonfigurierte Kapazitaet ausblenden. Siehe applyLocalSalesOverrides.
  rawSlots = applyLocalSalesOverrides(rawSlots);

  // Eigene Kapazitaet konfiguriert? Dann ANNYs Restplaetze verwerfen und aus
  // den Buchungen DIESES Service neu rechnen - sonst zeigt der Picker den Slot
  // als voll, weil ein anderer Service dieselbe ANNY-Resource belegt.
  const usageResourceId =
    targetResourceId
    ?? match.resourceIds?.[0]
    ?? rawSlots.flatMap((s) => s.resourceIds ?? [])[0];
  if (service.slotCapacity != null && service.slotCapacity > 0 && usageResourceId) {
    const [usage, ticketsToday, slotBlocks] = await Promise.all([
      fetchAnnyResourceDayUsage(
        baseUrl, annyConfig.token, usageResourceId, dateStr, organizationId,
      ).catch(() => null),
      prisma.ticket.findMany({
        where: {
          accountId,
          serviceId: service.id,
          status: { in: ["VALID", "REDEEMED"] },
          slotStart: { not: null },
          startDate: { lte: new Date(`${dateStr}T23:59:59${berlinOffset(dateStr)}`) },
          endDate: { gte: new Date(`${dateStr}T00:00:00${berlinOffset(dateStr)}`) },
        },
        select: { slotStart: true },
      }),
      // Sperren der ANDEREN Services derselben Resource - die duerfen diesen
      // Service nicht blockieren.
      prisma.slotBlock.findMany({
        where: { accountId, date: dateStr, serviceId: { not: service.id } },
        select: { annyBookingIds: true },
      }),
    ]);
    if (usage) {
      const empByStart = new Map<string, number>();
      for (const t of ticketsToday) {
        const key = t.slotStart?.slice(0, 5);
        if (!key) continue;
        empByStart.set(key, (empByStart.get(key) ?? 0) + 1);
      }
      const ignoredBlockerIds = new Set<string>();
      for (const b of slotBlocks) {
        try {
          const parsed = JSON.parse(b.annyBookingIds ?? "[]");
          if (Array.isArray(parsed)) {
            for (const id of parsed) if (typeof id === "string") ignoredBlockerIds.add(id);
          }
        } catch { /* ignore */ }
      }
      rawSlots = applyOwnSlotCapacity(rawSlots, {
        slotCapacity: service.slotCapacity,
        annyServiceIds: [annyServiceUuid],
        usage,
        ignoredBlockerIds,
        empBookingsByStart: empByStart,
      });
    }
  }

  // Wir reichen ALLE Slots durch (auch nicht-verfuegbare), damit das UI
  // dem Mitarbeiter ehrlich zeigt: "diese Zeit kennt ANNY, ist aber voll".
  // Filtern wir hier weg, sieht das im UI so aus, als gaebe es den Slot gar
  // nicht - das ist verwirrend, vor allem wenn nur 1 Slot tatsaechlich frei
  // ist.
  const slots: AvailabilitySlot[] = rawSlots
    .filter((s) => s.startTime)
    .map((s) => ({
      startTime: s.startTime,
      endTime: s.endTime,
      startIso: s.startIso,
      endIso: s.endIso,
      available: s.available,
      ...(typeof s.capacity === "number" ? { capacity: s.capacity } : {}),
      ...(typeof s.remaining === "number" ? { remaining: s.remaining } : {}),
      ...(s.unavailabilityType ? { unavailabilityType: s.unavailabilityType } : {}),
    }));

  return NextResponse.json({
    slots,
    hasAnnyLink: true,
    resourceCount: 1,
    serviceType,
    serviceInfo: match.serviceInfo,
    ...(debug
      ? {
          rawAnnySlots: rawSlots,
          annyServiceUuid,
          organizationId,
        }
      : {}),
  });
}
