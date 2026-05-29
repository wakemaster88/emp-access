import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  resolveAnnyOrganizationId,
  fetchAnnyServiceMatch,
  fetchAnnyServiceStartSlots,
  resolveServiceResourceId,
} from "@/lib/anny-availability";
import { createAnnyBooking, cancelAnnyBooking } from "@/lib/anny-bookings";

export const maxDuration = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * Baut aus EMP-Service-Name + annyNames-JSON die Suchliste fuer den
 * ANNY-Katalog (identisch zur Strategie in /ticket und /slot-overview).
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
    if (parts.length > 1) for (const p of parts) if (p.trim()) names.push(p.trim());
  }
  return Array.from(new Set(names));
}

/**
 * POST: sperrt einen Slot. Belegt die volle Restkapazitaet des Slots in
 * ANNY ueber eine Platzhalter-Buchung (check_availability:false, damit der
 * Block immer durchgeht) und legt einen SlotBlock-Datensatz an.
 *
 * Body: { serviceId, date (YYYY-MM-DD), slotStart (HH:mm), slotEnd (HH:mm), reason? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  const accountId = monitor.accountId;

  let body: {
    serviceId?: number;
    date?: string;
    slotStart?: string;
    slotEnd?: string;
    reason?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungueltiger Body" }, { status: 400 });
  }

  const serviceId = Number(body.serviceId);
  const date = (body.date ?? "").trim();
  const slotStart = (body.slotStart ?? "").trim();
  const slotEnd = (body.slotEnd ?? "").trim();
  const reason = body.reason?.trim() || null;

  if (!Number.isInteger(serviceId) || !DATE_RE.test(date) || !TIME_RE.test(slotStart) || !TIME_RE.test(slotEnd)) {
    return NextResponse.json({ error: "serviceId, date (YYYY-MM-DD), slotStart/slotEnd (HH:mm) erforderlich" }, { status: 400 });
  }

  const svc = await prisma.service.findFirst({
    where: { id: serviceId, accountId },
    select: {
      id: true,
      name: true,
      annyNames: true,
      serviceAreas: {
        select: { area: { select: { annyLinks: { select: { annyResourceId: true } } } } },
      },
    },
  });
  if (!svc) {
    return NextResponse.json({ error: "Service nicht gefunden" }, { status: 404 });
  }

  // Bereits gesperrt? (idempotent - nicht doppelt blocken)
  const existing = await prisma.slotBlock.findFirst({
    where: { accountId, serviceId, date, slotStart },
  });
  if (existing) {
    return NextResponse.json({ block: serializeBlock(existing), alreadyBlocked: true });
  }

  const annyConfig = await prisma.apiConfig.findFirst({
    where: { accountId, provider: "ANNY" },
    select: { token: true, baseUrl: true, extraConfig: true },
  });
  if (!annyConfig?.token) {
    return NextResponse.json(
      { error: "Keine ANNY-Verknuepfung konfiguriert - Slot kann nicht in ANNY gesperrt werden." },
      { status: 400 },
    );
  }

  const baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
  const organizationId = await resolveAnnyOrganizationId(baseUrl, annyConfig.token, annyConfig.extraConfig);
  const uniqueNames = collectServiceNames(svc.name, svc.annyNames);
  const match = await fetchAnnyServiceMatch(baseUrl, annyConfig.token, uniqueNames, organizationId);
  const annyServiceUuid = match.id;
  if (!annyServiceUuid) {
    return NextResponse.json(
      { error: `ANNY-Service nicht gefunden (gesucht: ${uniqueNames.slice(0, 3).join(", ")}).` },
      { status: 422 },
    );
  }

  // Resource: bei Services, die mehrere Resources bedienen (Seilbahn A/B),
  // exakt die zu DIESEM EMP-Service gehoerende Resource (Schnittmenge
  // EMP-Resources ∩ ANNY-Service-Resources), damit wir B nicht auf A sperren.
  const serviceLinkedResourceIds = svc.serviceAreas
    .flatMap((sa) => sa.area?.annyLinks ?? [])
    .map((l) => l.annyResourceId)
    .filter((x): x is string => !!x);
  const targetResourceId = resolveServiceResourceId(
    serviceLinkedResourceIds,
    match.resourceIds ?? [],
  );

  // Aktuelle Slots holen (auf die Ziel-Resource gefiltert, sofern eindeutig),
  // um Restkapazitaet + exakte ISO-Zeit dieses Slots zu bestimmen.
  const slots = await fetchAnnyServiceStartSlots(baseUrl, annyConfig.token, annyServiceUuid, date, {
    organizationId,
    ...(targetResourceId ? { resourceId: targetResourceId } : {}),
  }).catch(() => []);
  const slot = slots.find((s) => s.startTime === slotStart);

  // Resource: Ziel-Resource bevorzugen, sonst aus dem konkreten Slot
  // (resource_ids), sonst erster verknuepfter Resource-Link.
  const linkedResource = serviceLinkedResourceIds.find((id) => !!id);
  const resourceUuid = targetResourceId ?? slot?.resourceIds?.[0] ?? linkedResource ?? null;
  if (!resourceUuid) {
    return NextResponse.json({ error: "Keine ANNY-Resource fuer diesen Slot gefunden." }, { status: 422 });
  }

  // Wieviele Plaetze belegen, um den Slot komplett zu sperren?
  const remaining = typeof slot?.remaining === "number" ? slot.remaining : null;
  const capacity = typeof slot?.capacity === "number" ? slot.capacity : null;
  const quantity = Math.max(1, remaining && remaining > 0 ? remaining : capacity && capacity > 0 ? capacity : 1);

  // Exakte ISO-Zeiten: aus dem Slot, sonst aus date+time in Berlin-Offset.
  const startIso = slot?.startIso ?? buildIso(date, slotStart);
  const endIso = slot?.endIso ?? buildIso(date, slotEnd);

  const result = await createAnnyBooking({
    baseUrl,
    token: annyConfig.token,
    serviceUuid: annyServiceUuid,
    resourceUuid,
    startIso,
    endIso,
    quantity,
    description: `EMP-Access - GESPERRT${reason ? ` (${reason})` : ""}`,
    notifyCustomer: false,
    // Admin-Override: der Slot soll definitiv gesperrt werden, auch wenn
    // ANNY ihn (z.B. wegen Lead-Time) sonst nicht freigeben wuerde.
    checkAvailability: false,
    organizationId,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: `ANNY-Sperre fehlgeschlagen (Status ${result.status}). Slot wurde NICHT gesperrt.`,
        detail: result.error?.slice(0, 300),
      },
      { status: 502 },
    );
  }

  const block = await prisma.slotBlock.create({
    data: {
      accountId,
      serviceId,
      serviceName: svc.name,
      date,
      slotStart,
      slotEnd,
      startDate: new Date(startIso),
      endDate: new Date(endIso),
      quantity,
      reason,
      annyBookingIds: JSON.stringify(result.bookingIds),
      annyOrderId: result.orderId,
    },
  });

  return NextResponse.json({ block: serializeBlock(block) });
}

/**
 * DELETE: hebt einen Slot-Block auf. Storniert alle zugehoerigen
 * ANNY-Platzhalter-Buchungen und loescht den SlotBlock. Schlaegt ein
 * ANNY-Storno fehl, bleibt der Block erhalten (damit man es erneut
 * versuchen kann) und es wird 502 zurueckgegeben.
 *
 * Body: { blockId }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  const accountId = monitor.accountId;

  let body: { blockId?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungueltiger Body" }, { status: 400 });
  }
  const blockId = Number(body.blockId);
  if (!Number.isInteger(blockId)) {
    return NextResponse.json({ error: "blockId erforderlich" }, { status: 400 });
  }

  const block = await prisma.slotBlock.findFirst({ where: { id: blockId, accountId } });
  if (!block) {
    return NextResponse.json({ error: "Sperre nicht gefunden" }, { status: 404 });
  }

  const annyConfig = await prisma.apiConfig.findFirst({
    where: { accountId, provider: "ANNY" },
    select: { token: true, baseUrl: true, extraConfig: true },
  });

  const bookingIds: string[] = (() => {
    try {
      const parsed = JSON.parse(block.annyBookingIds ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  })();

  const failed: string[] = [];
  if (annyConfig?.token && bookingIds.length > 0) {
    const baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
    const organizationId = await resolveAnnyOrganizationId(baseUrl, annyConfig.token, annyConfig.extraConfig);
    for (const bid of bookingIds) {
      const res = await cancelAnnyBooking(baseUrl, annyConfig.token, bid, organizationId);
      if (!res.ok) failed.push(bid);
    }
  }

  if (failed.length > 0) {
    return NextResponse.json(
      {
        error: `ANNY-Storno fehlgeschlagen fuer ${failed.length} Buchung(en). Sperre bleibt bestehen - bitte erneut versuchen.`,
      },
      { status: 502 },
    );
  }

  await prisma.slotBlock.delete({ where: { id: block.id } });
  return NextResponse.json({ ok: true });
}

function buildIso(date: string, time: string): string {
  // Berlin-Offset: simple Naeherung (CET/CEST). Genau genug, weil ANNY den
  // Slot ohnehin ueber start_date matcht und wir den Wert primaer aus dem
  // Slot selbst beziehen; das ist nur Fallback.
  const month = parseInt(date.slice(5, 7), 10);
  const offset = month >= 4 && month <= 10 ? "+02:00" : "+01:00";
  return `${date}T${time}:00${offset}`;
}

function serializeBlock(b: {
  id: number;
  serviceId: number | null;
  serviceName: string;
  date: string;
  slotStart: string;
  slotEnd: string;
  quantity: number;
  reason: string | null;
}) {
  return {
    id: b.id,
    serviceId: b.serviceId,
    serviceName: b.serviceName,
    date: b.date,
    slotStart: b.slotStart,
    slotEnd: b.slotEnd,
    quantity: b.quantity,
    reason: b.reason,
  };
}
