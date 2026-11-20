import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { venueSession } from "@/lib/venue-session";
import { generatePartnerToken } from "@/lib/venue-events";
import { partnerSchema } from "@/lib/venue-event-rules";

export const dynamic = "force-dynamic";

const select = {
  id: true, name: true, contactName: true, logoUrl: true, contactEmail: true, notifyEmail: true,
  portalToken: true, portalEnabled: true, areaIds: true, editLockHours: true, horizonDays: true,
  _count: { select: { events: true } },
} as const;

/** Partner mit Portal-Einstellungen (nur Admins: der Link ist der Zugang). */
export async function GET() {
  const s = await venueSession({ requireAdmin: true });
  if ("error" in s) return s.error;
  const partners = await prisma.eventPartner.findMany({ where: { accountId: s.accountId }, select, orderBy: { name: "asc" } });
  return NextResponse.json({ partners });
}

export async function POST(request: NextRequest) {
  const s = await venueSession({ requireAdmin: true });
  if ("error" in s) return s.error;
  const parsed = partnerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  const d = parsed.data;
  const venues = await prisma.accessArea.findMany({ where: { accountId: s.accountId, eventVenue: true, id: { in: d.areaIds } }, select: { id: true } });
  const exists = await prisma.eventPartner.findFirst({ where: { accountId: s.accountId, name: d.name }, select: { id: true } });
  if (exists) return NextResponse.json({ error: "Einen Partner mit diesem Namen gibt es schon" }, { status: 409 });
  const partner = await prisma.eventPartner.create({
    data: {
      ...d,
      accountId: s.accountId,
      areaIds: venues.map((v) => v.id),
      ...(d.portalEnabled ? { portalToken: generatePartnerToken() } : {}),
    },
    select,
  });
  return NextResponse.json({ partner }, { status: 201 });
}
