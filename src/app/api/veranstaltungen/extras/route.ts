import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { venueSession } from "@/lib/venue-session";
import { extraSchema } from "@/lib/venue-event-rules";

export const dynamic = "force-dynamic";

/** Zusatzleistungen aller Veranstaltungsräume. */
export async function GET() {
  const s = await venueSession();
  if ("error" in s) return s.error;
  const extras = await prisma.venueExtra.findMany({
    where: { accountId: s.accountId },
    orderBy: [{ areaId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ extras });
}

export async function POST(request: NextRequest) {
  const s = await venueSession({ requireAdmin: true });
  if ("error" in s) return s.error;
  const parsed = extraSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  const area = await prisma.accessArea.findFirst({ where: { id: parsed.data.areaId, accountId: s.accountId, eventVenue: true }, select: { id: true } });
  if (!area) return NextResponse.json({ error: "Kein Veranstaltungsraum" }, { status: 400 });
  const extra = await prisma.venueExtra.create({ data: { ...parsed.data, accountId: s.accountId } });
  return NextResponse.json({ extra }, { status: 201 });
}
