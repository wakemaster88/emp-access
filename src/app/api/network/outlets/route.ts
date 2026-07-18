import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

const VALID_TYPES = ["WALL_OUTLET", "PATCH_PANEL"];

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const outlets = await db.networkOutlet.findMany({
    where: { accountId: accountId! },
    include: {
      port: { include: { device: { select: { id: true, name: true } } } },
    },
    orderBy: { label: "asc" },
  });
  return NextResponse.json(outlets);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json();
  if (!body.label?.trim()) {
    return NextResponse.json({ error: "Beschriftung ist erforderlich" }, { status: 400 });
  }
  if (body.type !== undefined && !VALID_TYPES.includes(body.type)) {
    return NextResponse.json({ error: "Ungültiger Anschluss-Typ" }, { status: 400 });
  }

  const dup = await db.networkOutlet.findFirst({
    where: { accountId: accountId!, label: body.label.trim() },
  });
  if (dup) {
    return NextResponse.json({ error: "Ein Anschluss mit dieser Beschriftung existiert bereits" }, { status: 400 });
  }

  const outlet = await db.networkOutlet.create({
    data: {
      label: body.label.trim(),
      location: body.location?.trim() || null,
      type: body.type ?? "WALL_OUTLET",
      notes: body.notes?.trim() || null,
      accountId: accountId!,
    },
  });
  return NextResponse.json(outlet, { status: 201 });
}
