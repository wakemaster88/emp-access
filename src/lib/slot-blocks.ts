import { prisma } from "@/lib/prisma";
import {
  resolveAnnyOrganizationId,
  fetchAnnyServiceMatch,
  fetchAnnyServiceStartSlots,
  resolveServiceResourceId,
  berlinOffset,
} from "@/lib/anny-availability";
import {
  createAnnyBlocker,
  deleteAnnyBooking,
  cancelAnnyBooking,
  annyBookingExists,
} from "@/lib/anny-bookings";

/**
 * Slot-Sperren (SlotBlock) anlegen und aufheben. Gemeinsame Logik fuer den
 * Check-in-Monitor (`/api/checkin/public/[token]/slot-block`) und das
 * Vereinsportal, dessen Buchungen den Slot genauso in ANNY sperren.
 */

export interface SlotBlockResult {
  status: number;
  body: Record<string, unknown>;
  /** ID der angelegten bzw. schon bestehenden Sperre (nur bei Erfolg). */
  blockId?: number;
  alreadyBlocked?: boolean;
}

function res(body: Record<string, unknown>, init?: { status?: number }): SlotBlockResult {
  const status = init?.status ?? 200;
  const block = body.block as { id?: number } | undefined;
  return {
    status,
    body,
    ...(status === 200 && block?.id != null ? { blockId: block.id } : {}),
    ...(body.alreadyBlocked === true ? { alreadyBlocked: true } : {}),
  };
}

export interface BlockSlotInput {
  serviceId: number;
  /** YYYY-MM-DD (Berlin) */
  date: string;
  /** HH:mm */
  slotStart: string;
  slotEnd: string;
  reason: string | null;
}

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
 * Sperrt einen Slot: belegt ihn in ANNY ueber einen nativen Blocker und legt
 * einen SlotBlock-Datensatz an. Idempotent: ist der Slot schon gesperrt,
 * kommt die bestehende Sperre mit `alreadyBlocked` zurueck.
 */
export async function blockServiceSlot(
  accountId: number,
  { serviceId, date, slotStart, slotEnd, reason }: BlockSlotInput,
): Promise<SlotBlockResult> {
  const svc = await prisma.service.findFirst({
    where: { id: serviceId, accountId },
    select: {
      id: true,
      name: true,
      annyNames: true,
      slotCapacity: true,
      serviceAreas: {
        select: { area: { select: { annyLinks: { select: { annyResourceId: true } } } } },
      },
    },
  });
  if (!svc) {
    return res({ error: "Service nicht gefunden" }, { status: 404 });
  }

  // Bereits gesperrt? (idempotent - nicht doppelt blocken)
  const existing = await prisma.slotBlock.findFirst({
    where: { accountId, serviceId, date, slotStart },
  });
  if (existing) {
    return res({ block: serializeBlock(existing), alreadyBlocked: true });
  }

  const annyConfig = await prisma.apiConfig.findFirst({
    where: { accountId, provider: "ANNY" },
    select: { token: true, baseUrl: true, extraConfig: true },
  });
  if (!annyConfig?.token) {
    return res(
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
    return res(
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
    return res({ error: "Keine ANNY-Resource fuer diesen Slot gefunden." }, { status: 422 });
  }

  // Wieviele Plaetze belegen, um den Slot komplett zu sperren? Bei Services
  // mit eigener Kapazitaet ist ANNYs Restwert unbrauchbar (er zaehlt die
  // Buchungen der anderen Services derselben Resource mit) - dann nehmen wir
  // die konfigurierte Kapazitaet.
  const remaining = typeof slot?.remaining === "number" ? slot.remaining : null;
  const capacity =
    svc.slotCapacity != null && svc.slotCapacity > 0
      ? svc.slotCapacity
      : typeof slot?.capacity === "number" ? slot.capacity : null;
  const effectiveRemaining = svc.slotCapacity != null && svc.slotCapacity > 0 ? null : remaining;
  const quantity = Math.max(
    1,
    effectiveRemaining && effectiveRemaining > 0
      ? effectiveRemaining
      : capacity && capacity > 0 ? capacity : 1,
  );

  // Exakte ISO-Zeiten: aus dem Slot, sonst aus date+time in Berlin-Offset.
  const startIso = slot?.startIso || buildIso(date, slotStart);
  const endIso = slot?.endIso || buildIso(date, slotEnd);

  // Slot in ANNY sperren ueber einen nativen Blocker (POST /bookings mit
  // is_blocker:true). Das ist der korrekte Weg - eine Platzhalter-Buchung
  // ueber /orders/from-config wuerde eine bezahlpflichtige Order erzeugen,
  // was ANNY fuer diesen Account mit 500 quittiert.
  const result = await createAnnyBlocker({
    baseUrl,
    token: annyConfig.token,
    resourceUuid,
    startIso,
    endIso,
    title: `EMP-Access - GESPERRT${reason ? ` (${reason})` : ""}`,
    organizationId,
  });

  if (!result.ok) {
    return res(
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
      annyBookingIds: JSON.stringify(result.blockerId ? [result.blockerId] : []),
      annyOrderId: null,
    },
  });

  return res({ block: serializeBlock(block) });
}

/**
 * Hebt eine Slot-Sperre auf: storniert die ANNY-Platzhalter und loescht den
 * SlotBlock. Schlaegt ein ANNY-Storno fehl, bleibt die Sperre erhalten
 * (Status 502), damit man es erneut versuchen kann.
 */
export async function releaseSlotBlock(
  accountId: number,
  block: { id: number; annyBookingIds: string | null },
): Promise<SlotBlockResult> {
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
      // 1) Nativer Blocker -> harter DELETE (behandelt 404 als Erfolg).
      let res = await deleteAnnyBooking(baseUrl, annyConfig.token, bid, organizationId);
      // 2) Fallback: aeltere Platzhalter-Buchungen lassen sich evtl. nur per
      //    Cancel-Endpoint aufheben (DELETE liefert dann 4xx/5xx).
      if (!res.ok) {
        await cancelAnnyBooking(baseUrl, annyConfig.token, bid, organizationId).catch(() => null);
      }
      // 3) Autoritative Absicherung: ist die Buchung in ANNY weg, gilt das
      //    Aufheben als erfolgreich - unabhaengig davon, welcher Endpoint
      //    gegriffen hat. Nur wenn sie nachweislich noch existiert, scheitern
      //    wir (damit der User nicht dauerhaft an einem ANNY-Fehler haengt).
      if (!res.ok) {
        const exists = await annyBookingExists(baseUrl, annyConfig.token, bid, organizationId);
        if (exists === false) res = { ok: true };
      }
      if (!res.ok) failed.push(bid);
    }
  }

  if (failed.length > 0) {
    return res(
      {
        error: `ANNY-Storno fehlgeschlagen fuer ${failed.length} Buchung(en). Sperre bleibt bestehen - bitte erneut versuchen.`,
      },
      { status: 502 },
    );
  }

  await prisma.slotBlock.delete({ where: { id: block.id } });
  return res({ ok: true });
}

function buildIso(date: string, time: string): string {
  // Fallback, wenn ANNY den Slot nicht (mehr) listet - etwa bei einer
  // freigegebenen Wunschzeit-Anfrage des Vereinsportals.
  return `${date}T${time}:00${berlinOffset(date)}`;
}

export function serializeBlock(b: {
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
