import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive) {
    return NextResponse.json({ error: "Monitor nicht gefunden" }, { status: 404 });
  }

  const ticketId = Number(request.nextUrl.searchParams.get("ticketId"));
  if (!ticketId || isNaN(ticketId)) {
    return NextResponse.json({ error: "ticketId erforderlich" }, { status: 400 });
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId: monitor.accountId },
    select: { profileImage: true },
  });

  return NextResponse.json(
    { profileImage: ticket?.profileImage ?? null },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive) {
    return NextResponse.json({ error: "Monitor nicht gefunden" }, { status: 404 });
  }

  const body = await request.json();
  const ticketId = Number(body.ticketId);
  const profileImage = body.profileImage as string;

  if (!ticketId || isNaN(ticketId)) {
    return NextResponse.json({ error: "ticketId erforderlich" }, { status: 400 });
  }
  if (!profileImage || typeof profileImage !== "string") {
    return NextResponse.json({ error: "profileImage erforderlich" }, { status: 400 });
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId: monitor.accountId },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Ticket nicht gefunden" }, { status: 404 });
  }

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { profileImage },
  });

  return NextResponse.json({ success: true });
}
