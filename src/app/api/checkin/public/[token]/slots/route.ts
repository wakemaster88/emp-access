import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  fetchAnnyServiceIdByName,
  fetchAnnyServiceStartSlots,
  type AvailabilitySlot,
} from "@/lib/anny-availability";

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
    select: { token: true, baseUrl: true },
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

  const annyServiceUuid = await fetchAnnyServiceIdByName(
    baseUrl,
    annyConfig.token,
    uniqueNames,
  );
  if (!annyServiceUuid) {
    return NextResponse.json({
      slots: [] as AvailabilitySlot[],
      hasAnnyLink: false,
      resourceCount: 0,
      note: "ANNY-Service nicht gefunden",
    });
  }

  // Dauer: bevorzugt vom Service in unserer DB (defaultValidityDurationMinutes).
  // ANNY laesst die Dauer optional - ohne Dauer bekommen wir typischerweise
  // alle moeglichen Start-Intervalle in der min-duration des Services.
  const duration = service.defaultValidityDurationMinutes ?? undefined;

  let rawSlots: Awaited<ReturnType<typeof fetchAnnyServiceStartSlots>> = [];
  try {
    rawSlots = await fetchAnnyServiceStartSlots(
      baseUrl,
      annyConfig.token,
      annyServiceUuid,
      dateStr,
      { durationMinutes: duration },
    );
  } catch {
    return NextResponse.json({
      slots: [] as AvailabilitySlot[],
      hasAnnyLink: true,
      resourceCount: 0,
      error: "ANNY nicht erreichbar",
    });
  }

  // Nur tatsaechlich verfuegbare Start-Intervalle zeigen.
  const slots: AvailabilitySlot[] = rawSlots
    .filter((s) => s.available && s.startTime)
    .map((s) => ({
      startTime: s.startTime,
      endTime: s.endTime,
      startIso: s.startIso,
      endIso: s.endIso,
      ...(typeof s.remaining === "number" ? { remaining: s.remaining } : {}),
    }));

  return NextResponse.json({
    slots,
    hasAnnyLink: true,
    resourceCount: 1,
  });
}
