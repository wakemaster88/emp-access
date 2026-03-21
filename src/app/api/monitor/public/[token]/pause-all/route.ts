import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
    const action = body.action as string;

    if (action === "pause") {
      const now = new Date();
      const tickets = await prisma.ticket.findMany({
        where: {
          accountId: monitor.accountId,
          status: { in: ["VALID", "REDEEMED"] },
        },
        select: { id: true, validityType: true, firstScanAt: true, validityDurationMinutes: true, extras: true },
      });

      for (const t of tickets) {
        const ext = (t.extras as Record<string, unknown>) ?? {};
        if (t.validityType === "DURATION" && t.firstScanAt && t.validityDurationMinutes) {
          const expiresAt = new Date(t.firstScanAt).getTime() + t.validityDurationMinutes * 60_000;
          const remainingMs = Math.max(0, expiresAt - now.getTime());
          ext.pausedAtMs = now.getTime();
          ext.remainingMs = remainingMs;
        }
        ext.previousStatus = "VALID";
        await prisma.ticket.update({
          where: { id: t.id },
          data: { status: "PAUSED", extras: ext as Prisma.InputJsonValue },
        });
      }

      return NextResponse.json({ success: true, action: "paused", count: tickets.length });
    }

    if (action === "resume") {
      const now = new Date();
      const tickets = await prisma.ticket.findMany({
        where: {
          accountId: monitor.accountId,
          status: "PAUSED",
        },
        select: { id: true, validityType: true, validityDurationMinutes: true, extras: true },
      });

      for (const t of tickets) {
        const ext = (t.extras as Record<string, unknown>) ?? {};
        let firstScanAt: Date | undefined;
        if (t.validityType === "DURATION" && typeof ext.remainingMs === "number" && t.validityDurationMinutes) {
          firstScanAt = new Date(now.getTime() - (t.validityDurationMinutes * 60_000 - ext.remainingMs));
        }

        delete ext.pausedAtMs;
        delete ext.remainingMs;
        delete ext.previousStatus;

        await prisma.ticket.update({
          where: { id: t.id },
          data: {
            status: "VALID",
            extras: ext as Prisma.InputJsonValue,
            ...(firstScanAt ? { firstScanAt } : {}),
          },
        });
      }

      return NextResponse.json({ success: true, action: "resumed", count: tickets.length });
    }

    return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });
  } catch (err) {
    console.error("pause-all error:", err);
    return NextResponse.json(
      { error: "Interner Fehler", detail: String(err) },
      { status: 500 }
    );
  }
}
