import type { TenantDb } from "./prisma";
import { kioskVisibleDoors, LINK_RULES_OFF } from "./link-rules";
import { PAUSE_ALL_MARKER } from "./pause-all-marker";

/**
 * „Betrifft heute“ der Regeln für Links und Monitore. Nur lesend und auf den
 * Mandanten beschränkt.
 */
export async function countLinkRulesAffected(db: TenantDb, accountId: number) {
  const employeeWithLink = { accountId, source: "EMP_CONTROL" as const, mobileToken: { not: null } };
  const [employeesWithLink, employeesWithGrant, kioskMonitors, doors, resourceMonitors, pausedTickets, pausedByPauseAll] = await Promise.all([
    db.ticket.count({ where: employeeWithLink }),
    db.ticket.count({ where: { ...employeeWithLink, mobileEmergencyGrant: true } }),
    db.monitorConfig.findMany({
      where: { accountId, type: "CHECKIN", isActive: true },
      select: { name: true, deviceIds: true },
      orderBy: { name: "asc" },
    }),
    // Dieselbe Türliste wie der Kiosk (api/checkin/public/[token]).
    db.device.findMany({
      where: { accountId, category: { in: ["TUER", "DREHKREUZ"] } },
      select: { id: true },
    }),
    db.monitorConfig.count({ where: { accountId, type: "RESOURCE_MONITOR", isActive: true } }),
    db.ticket.count({ where: { accountId, status: "PAUSED" } }),
    db.ticket.count({ where: { accountId, status: "PAUSED", extras: { path: ["pausedBy"], equals: PAUSE_ALL_MARKER } } }),
  ]);
  const assignedOnly = { ...LINK_RULES_OFF, kioskDoorsAssignedOnly: true };
  return {
    /** Mitarbeiter mit Handy-Link. */
    employeesWithLink,
    /** Davon mit Haken „NOT-AUF und Sperren erlaubt“. */
    employeesWithGrant,
    /** Je aktivem Kiosk: Türen heute und mit der Regel „nur zugeordnete“. */
    kiosks: kioskMonitors.map((m) => ({
      name: m.name,
      doorsToday: doors.length,
      doorsAssigned: kioskVisibleDoors(assignedOnly, doors, m.deviceIds).length,
    })),
    /** Aktive Auslastungs-Monitore. */
    resourceMonitors,
    /** Pausierte Tickets und davon mit Kennung „Alle pausieren“. */
    pausedTickets,
    pausedByPauseAll,
  };
}
