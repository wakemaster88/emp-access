import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  }
  if (!["RASPBERRY_PI", "SHELLY"].includes(body.type)) {
    return NextResponse.json({ error: "Ungültiger Gerätetyp" }, { status: 400 });
  }

  const VALID_CATEGORIES = ["DREHKREUZ", "TUER", "SENSOR", "SCHALTER", "BELEUCHTUNG"];

  const { db, accountId } = session;

  const device = await db.device.create({
    data: {
      name: body.name.trim(),
      type: body.type,
      category: body.category && VALID_CATEGORIES.includes(body.category) ? body.category : null,
      ipAddress: body.ipAddress || null,
      shellyId: body.shellyId || null,
      shellyAuthKey: body.shellyAuthKey || null,
      isActive: body.isActive ?? true,
      accessIn: body.accessIn ? Number(body.accessIn) : null,
      accessOut: body.accessOut ? Number(body.accessOut) : null,
      allowReentry: body.allowReentry ?? false,
      schedule: body.schedule ?? null,
      accountId: accountId!,
    },
  });

  return NextResponse.json(device, { status: 201 });
}
