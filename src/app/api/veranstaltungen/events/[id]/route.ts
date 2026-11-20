import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseId, venueSession } from "@/lib/venue-session";
import { loadEvent, logChange, notifyPartner, saveEvent, serializeEventForAdmin } from "@/lib/venue-events";
import { eventInputSchema } from "@/lib/venue-event-rules";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Termin mit Verlauf. */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const s = await venueSession();
  if ("error" in s) return s.error;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const event = await loadEvent(s.accountId, id);
  if (!event) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const changes = await prisma.venueEventChange.findMany({
    where: { eventId: id },
    orderBy: { at: "desc" },
    take: 50,
    select: { at: true, by: true, byName: true, summary: true },
  });
  return NextResponse.json({
    event: serializeEventForAdmin(event),
    changes: changes.map((c) => ({ ...c, at: c.at.toISOString() })),
  });
}

const putSchema = eventInputSchema.extend({
  internalNote: z.string().trim().max(2000).nullish().transform((v) => v || null),
  actualGuests: z.coerce.number().int().min(0).max(10_000).nullish(),
});

/** Termin ändern. Das Backoffice darf das immer, auch nach Fristende. */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const s = await venueSession();
  if ("error" in s) return s.error;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  const { internalNote, actualGuests, ...input } = parsed.data;
  const result = await saveEvent({ accountId: s.accountId, actor: s.actor, input, eventId: id, internalNote });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  let event = result.event;
  if (actualGuests !== undefined && actualGuests !== event.actualGuests) {
    await prisma.venueEvent.update({ where: { id }, data: { actualGuests: actualGuests ?? null } });
    await logChange(id, s.actor, `Tatsächliche Personen ${actualGuests ?? "–"}`);
    event = (await loadEvent(s.accountId, id))!;
  }
  return NextResponse.json({ event: serializeEventForAdmin(event) });
}

const actionSchema = z.object({
  action: z.enum(["confirm", "cancel", "billed", "unbilled", "reopen"]),
  /** Partner per Mail informieren (Bestätigung/Absage). */
  notify: z.boolean().default(true),
});

/** Status-Aktionen: bestätigen, absagen, wieder aufnehmen, abgerechnet. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const s = await venueSession();
  if ("error" in s) return s.error;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unbekannte Aktion" }, { status: 400 });
  const event = await loadEvent(s.accountId, id);
  if (!event) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const { action, notify } = parsed.data;
  const now = new Date();

  if (action === "reopen") {
    if (event.status !== "CANCELED") return NextResponse.json({ error: "Der Termin ist nicht abgesagt." }, { status: 409 });
    // Wieder aufnehmen heißt neu prüfen, ob der Raum noch frei ist.
    const check = await saveEvent({
      accountId: s.accountId,
      actor: s.actor,
      eventId: id,
      input: {
        areaId: event.areaId, title: event.title, hostName: event.hostName, date: event.date,
        startTime: event.startTime, endTime: event.endTime, guestCount: event.guestCount, note: event.note,
        extras: event.extras.filter((x) => x.extraId != null).map((x) => ({ extraId: x.extraId!, quantity: x.quantity })),
        byName: null,
      },
      reopen: true,
    });
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  } else if (action === "confirm") {
    if (event.status === "CANCELED") return NextResponse.json({ error: "Der Termin ist abgesagt." }, { status: 409 });
    await prisma.venueEvent.update({ where: { id }, data: { status: "CONFIRMED", confirmedAt: now } });
    await logChange(id, s.actor, "Bestätigt");
  } else if (action === "cancel") {
    if (event.status === "CANCELED") return NextResponse.json({ error: "Schon abgesagt." }, { status: 409 });
    await prisma.venueEvent.update({ where: { id }, data: { status: "CANCELED", canceledAt: now, canceledBy: "ADMIN" } });
    await logChange(id, s.actor, "Abgesagt");
  } else if (action === "billed") {
    await prisma.venueEvent.update({ where: { id }, data: { billedAt: now } });
    await logChange(id, s.actor, "Als abgerechnet markiert");
  } else {
    await prisma.venueEvent.update({ where: { id }, data: { billedAt: null } });
    await logChange(id, s.actor, "Abrechnung zurückgenommen");
  }

  const fresh = (await loadEvent(s.accountId, id))!;
  if (notify && fresh.partnerId && (action === "confirm" || action === "cancel")) {
    const partner = await prisma.eventPartner.findFirst({ where: { id: fresh.partnerId, accountId: s.accountId } });
    if (partner) {
      await notifyPartner(
        partner,
        fresh,
        action === "confirm" ? `Termin bestätigt: ${fresh.title}` : `Termin abgesagt: ${fresh.title}`,
        action === "confirm" ? "Wir haben euren Termin bestätigt." : "Euer Termin wurde von uns abgesagt. Bei Fragen meldet euch bitte.",
        request.nextUrl.origin,
      );
    }
  }
  return NextResponse.json({ event: serializeEventForAdmin(fresh) });
}
