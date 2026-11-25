import { NextRequest, NextResponse } from "next/server";
import { publicLinkRateLimit } from "@/lib/rate-limit";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadLinkRulesOrStrict } from "@/lib/link-rules-cache";
import {
  PAUSE_ALL_MARKER,
  groupPauseAllResume,
  pauseAllMarkable,
  pauseAllMarker,
  pauseAllResumeStatus,
  stripPauseAllMarker,
  withPauseAllMarker,
  type PauseAllPrevStatus,
} from "@/lib/pause-all-marker";

/**
 * Sammelt alle AccessArea-IDs, die ein Monitor "betrifft". Der Scope wird -
 * identisch zur Anzeige-Logik in `monitor-public-poll.ts` - aus ZWEI Quellen
 * zusammengefuehrt:
 *  1. `monitor.areaIds`: explizit am Monitor gewaehlte Bereiche (z.B.
 *     "Seilbahn B & Uebungslift", ein Monitor OHNE eigenes Scan-Geraet).
 *  2. `accessIn`/`accessOut` der zugeordneten Geraete (`monitor.deviceIds`).
 *
 * Frueher wurde NUR (2) ausgewertet und (1) ignoriert. Dadurch hatte ein
 * bereichseingegrenzter Monitor ohne Geraet einen leeren Scope -> pause-all
 * pausierte kontoweit ALLE Tickets (Vorfaelle 2026-05-23/05-27/06-24).
 *
 * Ein leeres Ergebnis bedeutet weiterhin: der Monitor hat keinen klaren
 * Bereichs-Scope (reiner Uebersichts-Monitor). pause-all verweigert in dem
 * Fall die Aktion, statt versehentlich alles zu pausieren.
 */
async function resolveMonitorAreaIds(
  monitorAccountId: number,
  deviceIds: unknown,
  explicitAreaIds: unknown,
): Promise<number[]> {
  const areaIds = new Set<number>();

  if (Array.isArray(explicitAreaIds)) {
    for (const x of explicitAreaIds) {
      const n = Number(x);
      if (Number.isFinite(n)) areaIds.add(n);
    }
  }

  const ids = Array.isArray(deviceIds)
    ? deviceIds.map((x) => Number(x)).filter((n) => Number.isFinite(n))
    : [];
  if (ids.length > 0) {
    const devices = await prisma.device.findMany({
      where: { id: { in: ids }, accountId: monitorAccountId },
      select: { accessIn: true, accessOut: true },
    });
    for (const d of devices) {
      if (d.accessIn != null) areaIds.add(d.accessIn);
      if (d.accessOut != null) areaIds.add(d.accessOut);
    }
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

/** Prisma-Filter: Ticket traegt die Kennung „Alle pausieren“. */
const MARKED_FILTER: Prisma.TicketWhereInput = {
  extras: { path: ["pausedBy"], equals: PAUSE_ALL_MARKER },
};

/**
 * Setzt bei pausierten Tickets die Kennung „Alle pausieren“ samt Status davor
 * (lib/pause-all-marker). Nur Extras-Objekte oder leere Extras; der Status
 * bleibt, wie ihn das Pausieren gesetzt hat.
 */
async function markPausedByPauseAll(accountId: number, ids: number[], previousStatus: PauseAllPrevStatus, at: Date) {
  if (ids.length === 0) return;
  const marker = pauseAllMarker(previousStatus, at);
  // Nur Buchfuehrung: ein Fehler hier darf die Pause-Antwort nicht kippen.
  try {
    await prisma.$executeRaw`
    UPDATE "Ticket"
    SET "extras" = CASE
      WHEN "extras" IS NULL OR jsonb_typeof("extras") = 'null' THEN ${JSON.stringify(marker)}::jsonb
      ELSE "extras" || ${JSON.stringify(marker)}::jsonb
    END
    WHERE "accountId" = ${accountId}
      AND "id" = ANY(${ids}::int[])
      AND "status" = 'PAUSED'
      AND ("extras" IS NULL OR jsonb_typeof("extras") IN ('null', 'object'))`;
  } catch (err) {
    console.error("pause-all marker error:", err);
  }
}

/**
 * Entfernt die Kennung „Alle pausieren“ wieder (nach dem Fortsetzen). Bleibt
 * danach nichts übrig, wird `extras` wieder leer (SQL NULL) wie vor dem
 * Pausieren; die Leser behandeln NULL und {} gleich, so bleibt aber auch der
 * gespeicherte Wert wie bisher.
 */
async function clearPauseAllMarker(accountId: number, ids: number[]) {
  if (ids.length === 0) return;
  try {
    await prisma.$executeRaw`
      UPDATE "Ticket"
      SET "extras" = CASE
        WHEN ("extras" - 'pausedBy' - 'pauseAllPrevStatus' - 'pauseAllAt') = '{}'::jsonb THEN NULL
        ELSE "extras" - 'pausedBy' - 'pauseAllPrevStatus' - 'pauseAllAt'
      END
      WHERE "accountId" = ${accountId}
        AND "id" = ANY(${ids}::int[])
        AND jsonb_typeof("extras") = 'object'`;
  } catch (err) {
    console.error("pause-all marker error:", err);
  }
}

/**
 * „Alle fortsetzen“ bei eingeschalteter Regel „„Alle fortsetzen“ hebt nur die
 * eigene Pause auf“: nur Tickets mit der Kennung „Alle pausieren“, jeweils
 * auf ihren Status davor. Einzeln, wegen offener Zahlung oder im Abgleich
 * pausierte Tickets bleiben pausiert; ebenso Tickets, die vor dieser Kennung
 * pausiert wurden.
 */
async function resumeOwnPause(accountId: number, scopeFilter: Prisma.TicketWhereInput, areaIds: number[]) {
  const now = new Date();
  const durationTickets = await prisma.ticket.findMany({
    where: {
      accountId,
      status: "PAUSED",
      validityType: "DURATION",
      validityDurationMinutes: { not: null },
      ...scopeFilter,
      ...MARKED_FILTER,
    },
    select: { id: true, validityDurationMinutes: true, extras: true },
  });

  let count = 0;
  for (const t of durationTickets) {
    const target = pauseAllResumeStatus(t.extras);
    if (!target) continue;
    const ext = { ...((t.extras as Record<string, unknown>) ?? {}) };
    let firstScanAt: Date | undefined;
    if (typeof ext.remainingMs === "number" && t.validityDurationMinutes) {
      firstScanAt = new Date(now.getTime() - (t.validityDurationMinutes * 60_000 - ext.remainingMs));
    }
    delete ext.pausedAtMs;
    delete ext.remainingMs;
    delete ext.previousStatus;
    stripPauseAllMarker(ext);
    await prisma.ticket.update({
      where: { id: t.id },
      data: { status: target, extras: ext as Prisma.InputJsonValue, ...(firstScanAt ? { firstScanAt } : {}) },
    });
    count++;
  }

  const marked = await prisma.ticket.findMany({
    where: {
      accountId,
      status: "PAUSED",
      id: { notIn: durationTickets.map((t) => t.id) },
      ...scopeFilter,
      ...MARKED_FILTER,
    },
    select: { id: true, extras: true },
  });
  const groups = groupPauseAllResume(marked);
  for (const status of ["VALID", "REDEEMED"] as const) {
    if (groups[status].length === 0) continue;
    const res = await prisma.ticket.updateMany({
      where: { accountId, status: "PAUSED", id: { in: groups[status] } },
      data: { status },
    });
    count += res.count;
  }
  await clearPauseAllMarker(accountId, [...groups.VALID, ...groups.REDEEMED]);

  return NextResponse.json({
    success: true,
    action: "resumed",
    count,
    scopeAreaIds: areaIds,
    // Nur mit eingeschalteter Regel: die Monitor-Seite erklaert damit count 0.
    onlyOwnPause: true,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const limited = publicLinkRateLimit(request, token, "monitor-pause-all");
    if (limited) return limited;
    const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
    if (!monitor || !monitor.isActive || monitor.type !== "MONITOR") {
      return NextResponse.json({ error: "Monitor nicht gefunden" }, { status: 404 });
    }

    const body = await request.json();
    const action = body.action as string;

    // Nur Tickets, die zum Bereichs-Scope dieses Monitors gehoeren,
    // werden ein-/ausgeschaltet. Bisher war pause-all global, was bei
    // bereichsspezifischen Monitoren (Seilbahn A, Strandbad) zu
    // unerwuenschten Massen-Pausen ueber den eigenen Scope hinaus
    // gefuehrt hat (Vorfaelle 2026-05-23: 877, 2026-05-27: 3.546,
    // 2026-06-24: 929 Tickets in jeweils einer Aktion).
    const areaIds = await resolveMonitorAreaIds(
      monitor.accountId,
      monitor.deviceIds,
      monitor.areaIds,
    );
    const scopeFilter = ticketAreaScopeFilter(areaIds);
    const scopeIsGlobal = areaIds.length === 0;

    // Read-only Preflight: liefert nur die Anzahl der Tickets, die ein
    // anschliessender "pause" (bzw. "resume") tatsaechlich anfassen wuerde.
    // Der Public-Monitor nutzt das, um vor dem "Alle pausieren"-Klick einen
    // Bestaetigungsdialog mit der konkreten Trefferzahl anzuzeigen
    // (Mass-Pause-Schutz nach Vorfall 2026-05-27: 3.546 Tickets unbemerkt
    // pausiert).
    // Regel „„Alle fortsetzen“ hebt nur die eigene Pause auf“ (lib/link-rules).
    const onlyOwnPause = (await loadLinkRulesOrStrict(prisma, monitor.accountId)).resumeOnlyOwnPause;

    if (action === "preview") {
      const targetStatus = (body.target as string) === "resume"
        ? ["PAUSED"]
        : ["VALID", "REDEEMED"];
      const where: Prisma.TicketWhereInput = {
        accountId: monitor.accountId,
        status: { in: targetStatus as ("VALID" | "REDEEMED" | "PAUSED")[] },
        ...scopeFilter,
      };
      let count: number;
      if (onlyOwnPause && (body.target as string) === "resume") {
        // Nur, was „Alle fortsetzen“ mit der Regel wirklich fortsetzt.
        const marked = await prisma.ticket.findMany({
          where: { ...where, ...MARKED_FILTER },
          select: { id: true, extras: true },
        });
        const groups = groupPauseAllResume(marked);
        count = groups.VALID.length + groups.REDEEMED.length;
      } else {
        count = await prisma.ticket.count({ where });
      }
      return NextResponse.json({
        success: true,
        action: "preview",
        count,
        scopeAreaIds: areaIds,
        scopeIsGlobal,
      });
    }

    if (action === "pause") {
      // Schutz gegen versehentliche account-weite Massen-Pausen: Ohne klaren
      // Bereichs-Scope (kein zugeordnetes Geraet/Bereich) wird NICHT pausiert.
      if (scopeIsGlobal) {
        return NextResponse.json(
          {
            error: "Massen-Pause ohne Bereichs-Scope ist deaktiviert.",
            detail:
              "Dieser Monitor ist keinem Bereich oder Scan-Geraet zugeordnet. " +
              "Eine kontoweite Pause aller Tickets wird aus Sicherheitsgruenden " +
              "nicht ausgefuehrt. Bitte einen bereichsspezifischen Monitor verwenden.",
            scopeIsGlobal: true,
          },
          { status: 400 },
        );
      }
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
        select: { id: true, status: true, firstScanAt: true, validityDurationMinutes: true, extras: true },
      });

      for (const t of durationTickets) {
        // Kennung „Alle pausieren“ und Status davor (lib/pause-all-marker).
        // Arrays und Einzelwerte in extras bleiben wie bisher ohne Kennung.
        const ext = pauseAllMarkable(t.extras)
          ? withPauseAllMarker(t.extras, t.status === "REDEEMED" ? "REDEEMED" : "VALID", now)
          : ((t.extras as Record<string, unknown>) ?? {});
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
      const bulkWhere: Prisma.TicketWhereInput = {
        accountId: monitor.accountId,
        status: { in: ["VALID", "REDEEMED"] },
        id: { notIn: durationIds },
        ...scopeFilter,
      };
      // Status davor merken, damit „Alle fortsetzen“ mit eingeschalteter
      // Regel genau diese Tickets auf ihren Status zuruecksetzen kann.
      const before = await prisma.ticket.findMany({ where: bulkWhere, select: { id: true, status: true } });
      const bulk = await prisma.ticket.updateMany({
        where: bulkWhere,
        data: { status: "PAUSED" },
      });
      await markPausedByPauseAll(monitor.accountId, before.filter((t) => t.status === "VALID").map((t) => t.id), "VALID", now);
      await markPausedByPauseAll(monitor.accountId, before.filter((t) => t.status === "REDEEMED").map((t) => t.id), "REDEEMED", now);

      return NextResponse.json({
        success: true,
        action: "paused",
        count: durationTickets.length + bulk.count,
        scopeAreaIds: areaIds,
      });
    }

    if (action === "resume") {
      if (onlyOwnPause) {
        if (scopeIsGlobal) {
          return NextResponse.json(
            {
              error: "Fortsetzen ohne Bereichs-Scope ist deaktiviert.",
              detail:
                "Dieser Monitor ist keinem Bereich oder Scan-Geraet zugeordnet. " +
                "Bitte am bereichsspezifischen Monitor fortsetzen.",
              scopeIsGlobal: true,
            },
            { status: 400 },
          );
        }
        return resumeOwnPause(monitor.accountId, scopeFilter, areaIds);
      }

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
        stripPauseAllMarker(ext);
        await prisma.ticket.update({
          where: { id: t.id },
          data: { status: "VALID", extras: ext as Prisma.InputJsonValue, ...(firstScanAt ? { firstScanAt } : {}) },
        });
      }

      const durationIds = durationTickets.map(t => t.id);
      const bulkWhere: Prisma.TicketWhereInput = {
        accountId: monitor.accountId,
        status: "PAUSED",
        id: { notIn: durationIds },
        ...scopeFilter,
      };
      const marked = await prisma.ticket.findMany({
        where: { ...bulkWhere, ...MARKED_FILTER },
        select: { id: true },
      });
      const bulk = await prisma.ticket.updateMany({
        where: bulkWhere,
        data: { status: "VALID" },
      });
      await clearPauseAllMarker(monitor.accountId, marked.map((t) => t.id));

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
      { error: "Interner Fehler" },
      { status: 500 }
    );
  }
}
