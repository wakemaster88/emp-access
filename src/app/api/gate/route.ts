import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { gateCheckSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = gateCheckSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  const { hardware, id } = parsed.data;
  const { db } = auth;

  const device = await db.device.findFirst({
    where: { id: hardware },
  });

  if (!device) {
    return NextResponse.json({ user: null, name: null, access: 0 });
  }

  const ticket = await db.ticket.findFirst({
    where: {
      OR: [{ rfidCode: id }, { qrCode: id }, { barcode: id }],
    },
  });

  if (!ticket) {
    await db.scan.create({
      data: {
        code: id,
        deviceId: hardware,
        result: "DENIED",
        accountId: auth.account.id,
      },
    });
    return NextResponse.json({ user: null, name: null, access: 0 });
  }

  const now = new Date();
  const isTimeValid =
    (!ticket.startDate || ticket.startDate <= now) &&
    (!ticket.endDate || ticket.endDate >= now);
  const isStatusValid = ticket.status === "VALID" || ticket.status === "PROTECTED";
  const granted = isTimeValid && isStatusValid;

  await db.scan.create({
    data: {
      code: id,
      deviceId: hardware,
      result: granted ? (ticket.status === "PROTECTED" ? "PROTECTED" : "GRANTED") : "DENIED",
      ticketId: ticket.id,
      accountId: auth.account.id,
    },
  });

  return NextResponse.json({
    user: ticket.id,
    name: ticket.name,
    access: granted ? 1 : 0,
  });
}
