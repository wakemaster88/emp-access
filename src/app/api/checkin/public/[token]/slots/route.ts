import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  fetchAnnyAvailabilityWithSlots,
  periodsToSlots,
  type AvailabilitySlot,
} from "@/lib/anny-availability";

export const maxDuration = 15;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Holt fuer einen Service an einem konkreten Datum die buchbaren Slots aus
 * ANNY. Verknuepfung: Service -> ServiceAreas -> AccessArea -> AnnyResourceLink.
 * Bei mehreren verknuepften Resources werden die Slots gemerged und ueber
 * Start-/End-Uhrzeit dedupliziert (gleiche Slot-Uhrzeiten aus verschiedenen
 * Trainer-Resources erscheinen einmal).
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

  // Service + verknuepfte Anny-Resources laden. Bei mehreren AccessAreas
  // sammeln wir alle Links (ein Service kann z.B. an "Strandbad" UND "Kurs-
  // Pool" haengen, jeder mit eigener Anny-Resource).
  const service = await prisma.service.findFirst({
    where: { id: serviceId, accountId },
    select: {
      id: true,
      serviceAreas: {
        select: {
          area: {
            select: {
              annyLinks: {
                select: { annyResourceId: true, annyName: true },
              },
            },
          },
        },
      },
    },
  });
  if (!service) {
    return NextResponse.json({ error: "Service nicht gefunden" }, { status: 404 });
  }

  const resourceIds: string[] = [
    ...new Set<string>(
      service.serviceAreas
        .flatMap((sa) => sa.area?.annyLinks ?? [])
        .map((l) => l.annyResourceId),
    ),
  ];

  if (resourceIds.length === 0) {
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
      resourceCount: resourceIds.length,
      note: "ANNY nicht konfiguriert",
    });
  }

  const baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");

  let raw: Record<string, { start: string; end: string }[]> = {};
  try {
    raw = await fetchAnnyAvailabilityWithSlots(
      baseUrl,
      annyConfig.token,
      resourceIds,
      dateStr,
    );
  } catch {
    // Wenn ANNY zickt, geben wir eine leere Slot-Liste zurueck und der
    // Client faellt auf das datetime-local-Fallback zurueck. So bleibt der
    // Shop-Workflow auch bei ANNY-Ausfall benutzbar.
    return NextResponse.json({
      slots: [] as AvailabilitySlot[],
      hasAnnyLink: true,
      resourceCount: resourceIds.length,
      error: "ANNY nicht erreichbar",
    });
  }

  // Slots aus allen Resources mergen + ueber (Start-/End-Uhrzeit) dedupen.
  const merged = Object.values(raw).flat();
  const slots = periodsToSlots(merged);

  return NextResponse.json({
    slots,
    hasAnnyLink: true,
    resourceCount: resourceIds.length,
  });
}
