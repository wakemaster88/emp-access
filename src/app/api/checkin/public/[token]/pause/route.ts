import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Pause/Resume eines einzelnen Tickets vom CHECKIN-Monitor (Shop).
 *
 * Body:
 *   { ticketId: number, action: "pause" | "resume",
 *     duration?: "1h"|"1d"|"1w"|"1m"|"unbegrenzt", reason?: string }
 *
 * Pause:
 *  - status -> PAUSED
 *  - extras.pausedAt, pausedUntil (NULL bei "unbegrenzt"),
 *    pauseReason, pauseDuration, previousStatus
 *  - Bei DURATION-Tickets, die schon laufen, wird pausedAtMs + remainingMs
 *    gespeichert, damit Resume die Restzeit korrekt zurueckspielen kann.
 *
 * Resume:
 *  - status -> VALID (bzw. previousStatus, sofern gesetzt)
 *  - Bei DURATION mit remainingMs: firstScanAt so neu berechnen, dass die
 *    Restzeit ab jetzt zaehlt (spiegelt die Logik aus
 *    monitor/public/[token]/pause-all/route.ts).
 *  - Pause-Felder in extras werden entfernt.
 */

const PAUSE_DURATIONS: Record<string, number | null> = {
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
  "1m": 30 * 24 * 60 * 60_000,
  unbegrenzt: null,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
    if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
      return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
    }

    const body = await request.json();
    const ticketId = Number(body.ticketId);
    const action = body.action as string;

    if (!ticketId || isNaN(ticketId)) {
      return NextResponse.json({ error: "ticketId erforderlich" }, { status: 400 });
    }
    if (action !== "pause" && action !== "resume") {
      return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });
    }

    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, accountId: monitor.accountId },
    });
    if (!ticket) {
      return NextResponse.json({ error: "Ticket nicht gefunden" }, { status: 404 });
    }

    const now = new Date();
    const existingExtras = (ticket.extras as Record<string, unknown> | null) ?? {};

    if (action === "pause") {
      const duration = (body.duration as string) || "unbegrenzt";
      if (!(duration in PAUSE_DURATIONS)) {
        return NextResponse.json({ error: "Ungültige Dauer" }, { status: 400 });
      }
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";

      const durationMs = PAUSE_DURATIONS[duration];
      const pausedUntil = durationMs != null ? new Date(now.getTime() + durationMs) : null;

      const nextExtras: Record<string, unknown> = { ...existingExtras };

      if (
        ticket.validityType === "DURATION" &&
        ticket.firstScanAt &&
        ticket.validityDurationMinutes
      ) {
        const expiresAt = new Date(ticket.firstScanAt).getTime() +
          ticket.validityDurationMinutes * 60_000;
        nextExtras.remainingMs = Math.max(0, expiresAt - now.getTime());
        nextExtras.pausedAtMs = now.getTime();
      }

      nextExtras.pausedAt = now.toISOString();
      nextExtras.pausedUntil = pausedUntil?.toISOString() ?? null;
      nextExtras.pauseReason = reason;
      nextExtras.pauseDuration = duration;
      nextExtras.previousStatus = ticket.status;

      const updated = await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          status: "PAUSED",
          extras: nextExtras as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
        select: { id: true, status: true, extras: true },
      });

      return NextResponse.json({
        success: true,
        action: "paused",
        pausedUntil: pausedUntil?.toISOString() ?? null,
        ticket: updated,
      });
    }

    // action === "resume"
    let firstScanAt: Date | undefined;
    if (
      ticket.validityType === "DURATION" &&
      ticket.validityDurationMinutes &&
      typeof existingExtras.remainingMs === "number"
    ) {
      const remainingMs = existingExtras.remainingMs as number;
      firstScanAt = new Date(
        now.getTime() - (ticket.validityDurationMinutes * 60_000 - remainingMs),
      );
    }

    const previousStatus = typeof existingExtras.previousStatus === "string"
      ? existingExtras.previousStatus
      : "VALID";
    const nextStatus = (["VALID", "REDEEMED"] as const).includes(
      previousStatus as "VALID" | "REDEEMED",
    )
      ? (previousStatus as "VALID" | "REDEEMED")
      : "VALID";

    const cleanExtras: Record<string, unknown> = { ...existingExtras };
    delete cleanExtras.pausedAt;
    delete cleanExtras.pausedUntil;
    delete cleanExtras.pauseReason;
    delete cleanExtras.pauseDuration;
    delete cleanExtras.pausedAtMs;
    delete cleanExtras.remainingMs;
    delete cleanExtras.previousStatus;

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: nextStatus,
        extras: cleanExtras as Prisma.InputJsonValue,
        ...(firstScanAt ? { firstScanAt } : {}),
        version: { increment: 1 },
      },
      select: { id: true, status: true, firstScanAt: true, extras: true },
    });

    return NextResponse.json({
      success: true,
      action: "resumed",
      ticket: updated,
    });
  } catch (err) {
    console.error("checkin pause error:", err);
    return NextResponse.json(
      { error: "Interner Fehler", detail: String(err) },
      { status: 500 }
    );
  }
}
