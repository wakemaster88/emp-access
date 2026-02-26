import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { getSessionWithDb } from "@/lib/api-auth";
import { ticketCreateSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const hasToken = request.nextUrl.searchParams.has("token") ||
    request.headers.has("authorization");

  let db, accountId: number;

  if (hasToken) {
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

  const accessId = request.nextUrl.searchParams.get("access");
  const since = request.nextUrl.searchParams.get("since");

  const where: Record<string, unknown> = { accountId };
  if (accessId) where.accessAreaId = Number(accessId);
  if (since) where.version = { gt: Number(since) };

  const tickets = await db.ticket.findMany({
    where,
    include: { accessArea: true },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(tickets);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const parsed = ticketCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  const ticket = await db.ticket.create({
    data: {
      name: data.name,
      qrCode: data.qrCode,
      rfidCode: data.rfidCode,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
      accessAreaId: data.accessAreaId,
      subscriptionId: data.subscriptionId,
      serviceId: data.serviceId,
      status: data.status ?? "VALID",
      barcode: data.barcode,
      firstName: data.firstName,
      lastName: data.lastName,
      ticketTypeName: data.ticketTypeName,
      validityType: data.validityType ?? "DATE_RANGE",
      slotStart: data.slotStart,
      slotEnd: data.slotEnd,
      validityDurationMinutes: data.validityDurationMinutes,
      profileImage: data.profileImage,
      accountId: accountId!,
    },
  });

  return NextResponse.json(ticket, { status: 201 });
}
