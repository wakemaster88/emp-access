import { prisma } from "@/lib/prisma";
import { isWithinSchedule } from "@/lib/schedule";

/**
 * Loads a "mobile-ready" employee profile by mobile token. Returns the
 * employee data PLUS the set of devices the employee may interact with
 * (union of direct-assigned devices and devices whose accessIn/accessOut
 * falls into one of the employee's areas). Time-of-day (weekSchedule) and
 * contract validity are NOT enforced here — the caller is responsible for
 * displaying the limitation (greyed-out buttons) or rejecting an action.
 */
export interface EmployeeMobileDevice {
  id: number;
  name: string;
  type: string;
  category: string | null;
  ipAddress: string | null;
  /// "direct" = via TicketDevice, "area" = via Bereich-Match.
  via: "direct" | "area";
  /// IDs der Bereiche, die das Geraet erschliessen (nur bei `via = "area"`).
  matchedAreaIds: number[];
}

export interface EmployeeMobileProfile {
  id: number;
  accountId: number;
  accountName: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  ticketTypeName: string | null;
  profileImage: string | null;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  weekSchedule: unknown;
  devices: EmployeeMobileDevice[];
  /// `null` falls keine Wochenplan-Beschraenkung; sonst { ok, reason }.
  scheduleCheck: { ok: boolean; reason?: string } | null;
  /// Vertragspruefung jetzt: ok wenn aktiv und im Zeitraum.
  contractOk: boolean;
  contractReason: string | null;
}

export async function loadEmployeeByMobileToken(
  token: string,
): Promise<EmployeeMobileProfile | null> {
  const employee = await prisma.ticket.findFirst({
    where: { mobileToken: token, source: "EMP_CONTROL" },
    include: {
      account: { select: { name: true } },
      ticketAreas: { select: { accessAreaId: true } },
      ticketDevices: {
        include: {
          device: {
            select: { id: true, name: true, type: true, category: true, ipAddress: true, isActive: true },
          },
        },
      },
      subscription: { select: { areas: { select: { id: true } } } },
      service: { select: { serviceAreas: { select: { accessAreaId: true } } } },
    },
  });
  if (!employee) return null;

  const accountId = employee.accountId;
  const accountName = employee.account?.name ?? "EMP Access";

  // Union aller Areas, ueber die der Mitarbeiter Zugang hat.
  const areaIds = new Set<number>();
  if (employee.accessAreaId) areaIds.add(employee.accessAreaId);
  for (const ta of employee.ticketAreas) areaIds.add(ta.accessAreaId);
  for (const a of employee.subscription?.areas ?? []) areaIds.add(a.id);
  for (const sa of employee.service?.serviceAreas ?? []) areaIds.add(sa.accessAreaId);

  // Direkt zugewiesene Geraete (additiv).
  const directDevices: EmployeeMobileDevice[] = employee.ticketDevices
    .filter((td) => td.device && td.device.isActive)
    .map((td) => ({
      id: td.device.id,
      name: td.device.name,
      type: td.device.type,
      category: td.device.category,
      ipAddress: td.device.ipAddress,
      via: "direct" as const,
      matchedAreaIds: [],
    }));

  // Geraete, die ueber die Areas erreichbar sind. Wir nehmen alle mit
  // accessIn ODER accessOut innerhalb der Area-Liste.
  let areaDevices: EmployeeMobileDevice[] = [];
  if (areaIds.size > 0) {
    const list = Array.from(areaIds);
    const found = await prisma.device.findMany({
      where: {
        accountId,
        isActive: true,
        OR: [{ accessIn: { in: list } }, { accessOut: { in: list } }],
      },
      select: {
        id: true,
        name: true,
        type: true,
        category: true,
        ipAddress: true,
        accessIn: true,
        accessOut: true,
      },
    });
    const directIds = new Set(directDevices.map((d) => d.id));
    areaDevices = found
      .filter((d) => !directIds.has(d.id))
      .map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        category: d.category,
        ipAddress: d.ipAddress,
        via: "area" as const,
        matchedAreaIds: [d.accessIn, d.accessOut].filter((x): x is number => x != null && areaIds.has(x)),
      }));
  }

  // Sortierung: Tueren oben (TUER), dann Drehkreuze, dann Schalter, dann Rest.
  const categoryRank: Record<string, number> = {
    TUER: 0,
    DREHKREUZ: 1,
    BELEUCHTUNG: 2,
    SCHALTER: 3,
    TASTER: 4,
    MARKISE: 5,
    ROLLTOR: 6,
    SENSOR: 7,
  };
  const devices = [...directDevices, ...areaDevices].sort((a, b) => {
    const ra = a.category ? (categoryRank[a.category] ?? 9) : 9;
    const rb = b.category ? (categoryRank[b.category] ?? 9) : 9;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });

  // Vertrags-/Status-Check.
  const now = new Date();
  let contractOk = true;
  let contractReason: string | null = null;
  if (employee.status === "INVALID") {
    contractOk = false;
    contractReason = "Mitarbeiter inaktiv";
  } else if (employee.status === "PROTECTED") {
    contractOk = false;
    contractReason = "Mitarbeiter gesperrt";
  } else if (employee.startDate) {
    const start = new Date(employee.startDate);
    start.setUTCHours(0, 0, 0, 0);
    if (now < start) {
      contractOk = false;
      contractReason = "Vertrag noch nicht aktiv";
    }
  }
  if (contractOk && employee.endDate) {
    const end = new Date(employee.endDate);
    end.setUTCHours(23, 59, 59, 999);
    if (now > end) {
      contractOk = false;
      contractReason = "Vertrag abgelaufen";
    }
  }

  return {
    id: employee.id,
    accountId,
    accountName,
    name: employee.name,
    firstName: employee.firstName,
    lastName: employee.lastName,
    ticketTypeName: employee.ticketTypeName,
    profileImage: employee.profileImage,
    status: employee.status,
    startDate: employee.startDate,
    endDate: employee.endDate,
    weekSchedule: employee.weekSchedule,
    devices,
    scheduleCheck: isWithinSchedule(employee.weekSchedule, now),
    contractOk,
    contractReason,
  };
}
