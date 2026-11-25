import type { Prisma } from "@prisma/client";
import type { TenantDb } from "./prisma";
import { berlinDayStart } from "./berlin-day";
import { splitPassbackAreas } from "./access-rules";

/**
 * „Betrifft heute“: was die Regeln heute treffen würden. Nur lesend und auf
 * den Mandanten beschränkt.
 */
export async function countAccessRulesAffected(db: TenantDb, accountId: number) {
  const now = new Date();
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  // Für Gutscheine zählt auch die Hauptressource des Service als Bereich.
  const servicesWithAreas = await db.service.findMany({
    where: { accountId, OR: [{ serviceAreas: { some: {} } }, { mainAccessAreaId: { not: null } }] },
    select: { id: true },
  });
  const serviceIdsWithAreas = servicesWithAreas.map((s) => s.id);
  // Aktive Scanner-Pis ohne Einlass- und Auslass-Bereich; 0 zählt wie in der
  // Scan-Route als „kein Bereich“.
  const readersWithoutAreaRows = await db.device.findMany({
    where: {
      accountId,
      type: "RASPBERRY_PI",
      isActive: true,
      AND: [
        { OR: [{ accessIn: null }, { accessIn: 0 }] },
        { OR: [{ accessOut: null }, { accessOut: 0 }] },
      ],
    },
    select: { id: true },
  });
  const readerIdsWithoutArea = readersWithoutAreaRows.map((d) => d.id);

  // Heute gültige Tickets, für die der Scan keinen Bereich ableitet (wie
  // die Bereichsprüfung in api/devices/pi/scan). Vereinsmitglieder ohne
  // Bereich lehnt der Scan schon heute ab.
  const ticketsWithoutAreaWhere: Prisma.TicketWhereInput = {
    accountId,
    status: { in: ["VALID", "REDEEMED"] },
    accessAreaId: null,
    vereinId: null,
    ticketAreas: { none: {} },
    AND: [
      { OR: [{ startDate: null }, { startDate: { lte: now } }] },
      { OR: [{ endDate: null }, { endDate: { gte: todayUtc } }] },
      { OR: [{ subscriptionId: null }, { subscription: { is: { areas: { none: {} } } } }] },
      { OR: [{ serviceId: null }, { service: { is: { serviceAreas: { none: {} } } } }] },
    ],
  };

  const [partnerScansAtReadersWithoutArea, ticketsWithoutArea, staffTicketsWithoutArea, vouchersWithArea, passback] = await Promise.all([
    // Gewährte Scans ohne Ticket (Wakesys, Binarytec) der letzten 7 Tage an
    // diesen Lesern; Dashboard-Öffnungen zählen nicht.
    readerIdsWithoutArea.length
      ? db.scan.count({
          where: {
            accountId,
            result: "GRANTED",
            ticketId: null,
            code: { not: "Dashboard-Öffnung" },
            scanTime: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60_000) },
            deviceId: { in: readerIdsWithoutArea },
          },
        })
      : Promise.resolve(0),
    db.ticket.count({ where: ticketsWithoutAreaWhere }),
    // Davon Mitarbeiter-Tickets (emp-control): sie trifft die Regel ebenso.
    db.ticket.count({ where: { ...ticketsWithoutAreaWhere, source: "EMP_CONTROL" } }),
    // Einlösbare Zutritts-Gutscheine mit eigenem Bereich oder Service-Bereichen.
    db.voucher.count({
      where: {
        accountId,
        kind: "ACCESS",
        redeemedAt: null,
        disabledAt: null,
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gte: berlinDayStart(now) } }] },
          {
            OR: [
              { accessAreaId: { not: null } },
              ...(serviceIdsWithAreas.length ? [{ serviceId: { in: serviceIdsWithAreas } }] : []),
            ],
          },
        ],
      },
    }),
    // Regel „Wiedereintritt …“: Bereiche mit Einlass-Leser, mit und ohne
    // aktiven Ausgangs-Leser (wie im Scan-Weg nur aktive Scanner-Pis).
    (async () => {
      const readers = await db.device.findMany({
        where: {
          accountId,
          type: "RASPBERRY_PI",
          isActive: true,
          OR: [{ accessIn: { not: null } }, { accessOut: { not: null } }],
        },
        select: { accessIn: true, accessOut: true },
      });
      const { applies, exempt } = splitPassbackAreas(readers);
      const ids = [...applies, ...exempt];
      const areas = ids.length
        ? await db.accessArea.findMany({ where: { accountId, id: { in: ids } }, select: { id: true, name: true } })
        : [];
      const names = (list: number[]) =>
        areas
          .filter((a) => list.includes(a.id))
          .map((a) => a.name)
          .sort((x, y) => x.localeCompare(y, "de"));
      return { applies: names(applies), exempt: names(exempt) };
    })(),
  ]);
  return {
    readersWithoutArea: readerIdsWithoutArea.length,
    partnerScansAtReadersWithoutArea,
    ticketsWithoutArea,
    staffTicketsWithoutArea,
    vouchersWithArea,
    /** Namen der Bereiche, in denen die Regel „Wiedereintritt …“ gilt. */
    passbackAreas: passback.applies,
    /** Bereiche mit Einlass-Leser, aber ohne Ausgangs-Leser: ausgenommen. */
    passbackExemptAreas: passback.exempt,
  };
}

