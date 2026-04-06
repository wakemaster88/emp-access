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
      const durationTickets = await prisma.ticket.findMany({
        where: {
          accountId: monitor.accountId,
          status: { in: ["VALID", "REDEEMED"] },
          validityType: "DURATION",
          firstScanAt: { not: null },
          validityDurationMinutes: { not: null },
        },
        select: { id: true, firstScanAt: true, validityDurationMinutes: true, extras: true },
      });

      for (const t of durationTickets) {
        const ext = (t.extras as Record<string, unknown>) ?? {};
        const expiresAt = new Date(t.firstScanAt!).getTime() + t.validityDurationMinutes! * 60_000;
        ext.pausedAtMs = now.getTime();
        ext.remainingMs = Math.max(0, expiresAt - now.getTime());
        ext.previousStatus = "VALID";
        await prisma.ticket.update({
          where: { id: t.id },
          data: { status: "PAUSED", extras: ext as Prisma.InputJsonValue },
        });
      }

      const durationIds = durationTickets.map(t => t.id);
      const bulk = await prisma.ticket.updateMany({
        where: {
          accountId: monitor.accountId,
          status: { in: ["VALID", "REDEEMED"] },
          id: { notIn: durationIds },
        },
        data: { status: "PAUSED" },
      });

      return NextResponse.json({ success: true, action: "paused", count: durationTickets.length + bulk.count });
    }

    if (action === "resume") {
      const now = new Date();
      const durationTickets = await prisma.ticket.findMany({
        where: {
          accountId: monitor.accountId,
          status: "PAUSED",
          validityType: "DURATION",
          validityDurationMinutes: { not: null },
        },
        select: { id: true, validityDurationMinutes: true, extras: true },
      });

      for (const t of durationTickets) {
        const ext = (t.extras as Record<string, unknown>) ?? {};
        let firstScanAt: Date | undefined;
        if (typeof ext.remainingMs === "number" && t.validityDurationMinutes) {
          firstScanAt = new Date(now.getTime() - (t.validityDurationMinutes * 60_000 - ext.remainingMs));
        }
        delete ext.pausedAtMs;
        delete ext.remainingMs;
        delete ext.previousStatus;
        await prisma.ticket.update({
          where: { id: t.id },
          data: { status: "VALID", extras: ext as Prisma.InputJsonValue, ...(firstScanAt ? { firstScanAt } : {}) },
        });
      }

      const durationIds = durationTickets.map(t => t.id);
      const bulk = await prisma.ticket.updateMany({
        where: {
          accountId: monitor.accountId,
          status: "PAUSED",
          id: { notIn: durationIds },
        },
        data: { status: "VALID" },
      });

      return NextResponse.json({ success: true, action: "resumed", count: durationTickets.length + bulk.count });
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
