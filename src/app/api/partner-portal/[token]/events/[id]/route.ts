import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicRateLimit } from "@/lib/rate-limit";
import {
  eventInclude,
  loadPortalPartner,
  logChange,
  notifyStaff,
  saveEvent,
  serializeEventForPartner,
  type PortalPartner,
} from "@/lib/venue-events";
import { eventInputSchema, partnerEditState, reportGuestsSchema, type VenueEventStatus } from "@/lib/venue-event-rules";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string; id: string }> };

async function loadOwn(request: NextRequest, params: Ctx["params"]) {
  const { token, id } = await params;
  const limited = publicRateLimit(token, "partner-portal-write", { limit: 30, windowMs: 60_000 });
  if (limited) return { error: limited };
  const partner = await loadPortalPartner(token);
  if (!partner) return { error: NextResponse.json({ error: "Nicht gefunden" }, { status: 404 }) };
  const eventId = Number(id);
  if (!Number.isInteger(eventId)) return { error: NextResponse.json({ error: "Ungültige ID" }, { status: 400 }) };
  // Nur eigene Termine: partnerId muss passen.
  const event = await prisma.venueEvent.findFirst({
    where: { id: eventId, accountId: partner.accountId, partnerId: partner.id },
    include: eventInclude,
  });
  if (!event) return { error: NextResponse.json({ error: "Nicht gefunden" }, { status: 404 }) };
  const state = partnerEditState(
    {
      status: event.status as VenueEventStatus,
      startDate: event.startDate,
      billedAt: event.billedAt,
      hasFinalInvoice: event.documents.some((d) => d.kind === "FINAL_INVOICE"),
    },
    partner.editLockHours,
  );
  return { partner, event, state };
}

function reply(partner: PortalPartner, event: Parameters<typeof serializeEventForPartner>[0]) {
  return NextResponse.json({ event: serializeEventForPartner(event, partner.editLockHours) });
}

/**
 * Termin ändern. Body mit `actualGuests` meldet nur die tatsächliche
 * Personenzahl (geht bis zur Schlussrechnung), sonst der ganze Termin
 * (bis zur Änderungsfrist).
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const loaded = await loadOwn(request, params);
  if ("error" in loaded) return loaded.error;
  const { partner, event, state } = loaded;
  const body = await request.json().catch(() => null);

  if (body && typeof body === "object" && "actualGuests" in body) {
    const parsed = reportGuestsSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Bitte eine Personenzahl angeben" }, { status: 400 });
    if (!state.canReportGuests) return NextResponse.json({ error: state.reason }, { status: 409 });
    if (event.startDate.getTime() > Date.now()) {
      return NextResponse.json({ error: "Die tatsächliche Personenzahl meldet ihr nach Beginn. Vorher ändert ihr die geplante." }, { status: 400 });
    }
    await prisma.venueEvent.update({ where: { id: event.id }, data: { actualGuests: parsed.data.actualGuests } });
    const actor = { by: "PARTNER" as const, name: parsed.data.byName };
    await logChange(event.id, actor, `Tatsächliche Personen ${parsed.data.actualGuests}`);
    const fresh = (await prisma.venueEvent.findFirst({ where: { id: event.id, accountId: partner.accountId }, include: eventInclude }))!;
    await notifyStaff(partner, fresh, `${parsed.data.actualGuests} Personen gemeldet`, request.nextUrl.origin);
    return reply(partner, fresh);
  }

  if (!state.canEdit) return NextResponse.json({ error: state.reason }, { status: 409 });
  const parsed = eventInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  const result = await saveEvent({
    accountId: partner.accountId,
    actor: { by: "PARTNER", name: parsed.data.byName },
    input: parsed.data,
    eventId: event.id,
    partnerRules: { areaIds: partner.areaIds, horizonDays: partner.horizonDays },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  if (result.changes.length > 0) {
    await notifyStaff(partner, result.event, `Termin geändert (${result.changes.join(", ")})`, request.nextUrl.origin);
  }
  return reply(partner, result.event);
}

/** Absagen (bis zur Änderungsfrist). */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const loaded = await loadOwn(request, params);
  if ("error" in loaded) return loaded.error;
  const { partner, event, state } = loaded;
  if (!state.canEdit) return NextResponse.json({ error: state.reason }, { status: 409 });
  const byName = request.nextUrl.searchParams.get("by")?.trim().slice(0, 120) || null;
  await prisma.venueEvent.update({ where: { id: event.id }, data: { status: "CANCELED", canceledAt: new Date(), canceledBy: "PARTNER" } });
  await logChange(event.id, { by: "PARTNER", name: byName }, "Abgesagt");
  const fresh = (await prisma.venueEvent.findFirst({ where: { id: event.id, accountId: partner.accountId }, include: eventInclude }))!;
  await notifyStaff(partner, fresh, "Termin abgesagt", request.nextUrl.origin);
  return reply(partner, fresh);
}
