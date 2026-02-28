import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb, validateApiToken } from "@/lib/api-auth";

function hasApiToken(request: NextRequest) {
  return request.nextUrl.searchParams.has("token") || request.headers.has("authorization");
}

export async function GET(request: NextRequest) {
  let db, accountId: number;
  if (hasApiToken(request)) {
    const auth = await validateApiToken(request);
    if ("error" in auth) return auth.error;
    db = auth.db;
    accountId = auth.account.id;
  } else {
    const session = await getSessionWithDb();
    if ("error" in session) return session.error;
    db = session.db;
    accountId = session.accountId!;
  }
  const devices = await db.device.findMany({
    where: { accountId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      type: true,
      category: true,
      isActive: true,
      task: true,
      accessIn: true,
      accessOut: true,
      lastUpdate: true,
    },
  });
  return NextResponse.json(devices);
}

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
