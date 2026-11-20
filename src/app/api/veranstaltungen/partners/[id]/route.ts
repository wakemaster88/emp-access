import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseId, venueSession } from "@/lib/venue-session";
import { generatePartnerToken } from "@/lib/venue-events";
import { partnerSchema } from "@/lib/venue-event-rules";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function load(accountId: number, raw: string) {
  const id = parseId(raw);
  if (!id) return null;
  return prisma.eventPartner.findFirst({ where: { id, accountId } });
}

/** Partner und Portal-Einstellungen speichern. Der Link entsteht beim ersten Einschalten. */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const s = await venueSession({ requireAdmin: true });
  if ("error" in s) return s.error;
  const partner = await load(s.accountId, (await params).id);
  if (!partner) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const parsed = partnerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  const d = parsed.data;
  const clash = await prisma.eventPartner.findFirst({ where: { accountId: s.accountId, name: d.name, id: { not: partner.id } }, select: { id: true } });
  if (clash) return NextResponse.json({ error: "Einen Partner mit diesem Namen gibt es schon" }, { status: 409 });
  const venues = await prisma.accessArea.findMany({ where: { accountId: s.accountId, eventVenue: true, id: { in: d.areaIds } }, select: { id: true } });
  await prisma.eventPartner.update({
    where: { id: partner.id },
    data: {
      ...d,
      areaIds: venues.map((v) => v.id),
      ...(d.portalEnabled && !partner.portalToken ? { portalToken: generatePartnerToken() } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}

/** `{ action: "rotate" }`: neuer Link, der alte gilt sofort nicht mehr. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const s = await venueSession({ requireAdmin: true });
  if ("error" in s) return s.error;
  const partner = await load(s.accountId, (await params).id);
  if (!partner) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "rotate") return NextResponse.json({ error: "Unbekannte Aktion" }, { status: 400 });
  const updated = await prisma.eventPartner.update({ where: { id: partner.id }, data: { portalToken: generatePartnerToken() }, select: { portalToken: true } });
  return NextResponse.json({ portalToken: updated.portalToken });
}

/** Löschen nur ohne Termine; sonst Portal ausschalten (die Termine gehören zur Abrechnung). */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const s = await venueSession({ requireAdmin: true });
  if ("error" in s) return s.error;
  const partner = await load(s.accountId, (await params).id);
  if (!partner) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const events = await prisma.venueEvent.count({ where: { accountId: s.accountId, partnerId: partner.id } });
  if (events > 0) {
    return NextResponse.json({ error: `Der Partner hat ${events} Termin(e). Schalte stattdessen seinen Zugang aus.` }, { status: 409 });
  }
  await prisma.eventPartner.delete({ where: { id: partner.id } });
  return NextResponse.json({ ok: true });
}
