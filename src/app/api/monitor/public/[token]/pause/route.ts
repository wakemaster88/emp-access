import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
    if (!monitor || !monitor.isActive) {
      return NextResponse.json({ error: "Monitor nicht gefunden" }, { status: 404 });
    }

    const body = await request.json();
    const ticketId = Number(body.ticketId);
    const duration = body.duration as string;
    const reason = (body.reason as string)?.trim() || "";

    if (!ticketId || isNaN(ticketId)) {
      return NextResponse.json({ error: "ticketId erforderlich" }, { status: 400 });
    }

    const validDurations: Record<string, number> = {
      "1h": 60 * 60_000,
      "1d": 24 * 60 * 60_000,
      "1w": 7 * 24 * 60 * 60_000,
      "1m": 30 * 24 * 60 * 60_000,
    };

    if (!duration || !validDurations[duration]) {
      return NextResponse.json({ error: "Ungültige Dauer" }, { status: 400 });
    }

    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, accountId: monitor.accountId },
    });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket nicht gefunden" }, { status: 404 });
    }

    const now = new Date();
    const pausedUntil = new Date(now.getTime() + validDurations[duration]);

    const existingExtras = (ticket.extras as Record<string, unknown>) ?? {};

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: "PAUSED",
        extras: {
          ...existingExtras,
          pausedAt: now.toISOString(),
          pausedUntil: pausedUntil.toISOString(),
          pauseReason: reason,
          pauseDuration: duration,
          previousStatus: ticket.status,
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: "Ticket pausiert",
      pausedUntil: pausedUntil.toISOString(),
    });
  } catch (err) {
    console.error("pause error:", err);
    return NextResponse.json(
      { error: "Interner Fehler", detail: String(err) },
      { status: 500 }
    );
  }
}
