import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Sammelt alle AccessArea-IDs, die ein Monitor "betrifft": Pro Geraet
 * werden `accessIn` und `accessOut` ausgelesen. Ein leeres Ergebnis
 * bedeutet, dass der Monitor keinen Bereich klar zugeordnet hat (z.B.
 * ein Uebersichts-Monitor ohne Geraete). In dem Fall darf pause-all
 * weiterhin global wirken - das ist der bisherige Fallback.
 */
async function resolveMonitorAreaIds(
  monitorAccountId: number,
  deviceIds: unknown,
): Promise<number[]> {
  const ids = Array.isArray(deviceIds)
    ? deviceIds.map((x) => Number(x)).filter((n) => Number.isFinite(n))
    : [];
  if (ids.length === 0) return [];
  const devices = await prisma.device.findMany({
    where: { id: { in: ids }, accountId: monitorAccountId },
    select: { accessIn: true, accessOut: true },
  });
  const areaIds = new Set<number>();
  for (const d of devices) {
    if (d.accessIn != null) areaIds.add(d.accessIn);
    if (d.accessOut != null) areaIds.add(d.accessOut);
  }
  return Array.from(areaIds);
}

/**
 * Liefert ein Prisma-Where-Fragment, das ein Ticket nur dann
 * matcht, wenn es einem der `areaIds` zugeordnet ist - entweder
 * direkt ueber `accessAreaId`/`ticketAreas` oder transitiv ueber
 * Subscription, Service oder Verein.
 *
 * Wenn `areaIds` leer ist, gibt es kein Filter zurueck: der Monitor
 * hat keinen klaren Bereichs-Scope, also bleibt das Verhalten global
 * (Rueckwaerts-kompatibel).
 */
function ticketAreaScopeFilter(areaIds: number[]): Prisma.TicketWhereInput {
  if (areaIds.length === 0) return {};
  return {
    OR: [
      { accessAreaId: { in: areaIds } },
      { ticketAreas: { some: { accessAreaId: { in: areaIds } } } },
      { service: { serviceAreas: { some: { accessAreaId: { in: areaIds } } } } },
      { subscription: { areas: { some: { id: { in: areaIds } } } } },
      {
        verein: {
          accessTickets: {
            some: {
              ticket: {
                OR: [
                  { accessAreaId: { in: areaIds } },
                  { ticketAreas: { some: { accessAreaId: { in: areaIds } } } },
                ],
              },
            },
          },
        },
      },
    ],
  };
}

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

    // Nur Tickets, die zum Bereichs-Scope dieses Monitors gehoeren,
    // werden ein-/ausgeschaltet. Bisher war pause-all global, was bei
    // bereichsspezifischen Monitoren (Seilbahn A, Strandbad) zu
    // unerwuenschten Massen-Pausen ueber den eigenen Scope hinaus
    // gefuehrt hat (Vorfall 2026-05-23: 877 Tickets in einer Aktion).
    const areaIds = await resolveMonitorAreaIds(monitor.accountId, monitor.deviceIds);
    const scopeFilter = ticketAreaScopeFilter(areaIds);

    // Read-only Preflight: liefert nur die Anzahl der Tickets, die ein
    // anschliessender "pause" (bzw. "resume") tatsaechlich anfassen wuerde.
    // Der Public-Monitor nutzt das, um vor dem "Alle pausieren"-Klick einen
    // Bestaetigungsdialog mit der konkreten Trefferzahl anzuzeigen
    // (Mass-Pause-Schutz nach Vorfall 2026-05-27: 3.546 Tickets unbemerkt
    // pausiert).
    if (action === "preview") {
      const targetStatus = (body.target as string) === "resume"
        ? ["PAUSED"]
        : ["VALID", "REDEEMED"];
      const count = await prisma.ticket.count({
        where: {
          accountId: monitor.accountId,
          status: { in: targetStatus as ("VALID" | "REDEEMED" | "PAUSED")[] },
          ...scopeFilter,
        },
      });
      return NextResponse.json({
        success: true,
        action: "preview",
        count,
        scopeAreaIds: areaIds,
        scopeIsGlobal: areaIds.length === 0,
      });
    }

    if (action === "pause") {
      const now = new Date();
      const durationTickets = await prisma.ticket.findMany({
        where: {
          accountId: monitor.accountId,
          status: { in: ["VALID", "REDEEMED"] },
          validityType: "DURATION",
          firstScanAt: { not: null },
          validityDurationMinutes: { not: null },
          ...scopeFilter,
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
          ...scopeFilter,
        },
        data: { status: "PAUSED" },
      });

      return NextResponse.json({
        success: true,
        action: "paused",
        count: durationTickets.length + bulk.count,
        scopeAreaIds: areaIds,
      });
    }

    if (action === "resume") {
      const now = new Date();
      const durationTickets = await prisma.ticket.findMany({
        where: {
          accountId: monitor.accountId,
          status: "PAUSED",
          validityType: "DURATION",
          validityDurationMinutes: { not: null },
          ...scopeFilter,
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
          ...scopeFilter,
        },
        data: { status: "VALID" },
      });

      return NextResponse.json({
        success: true,
        action: "resumed",
        count: durationTickets.length + bulk.count,
        scopeAreaIds: areaIds,
      });
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
