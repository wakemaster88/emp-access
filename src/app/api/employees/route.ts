import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { employeeCreateSchema } from "@/lib/validators";
import { randomBytes } from "crypto";

/**
 * Mitarbeiter sind Tickets mit `source = EMP_CONTROL` und `uuid = "emp-<id>"`.
 * Diese Route fasst Listen-/Create-Operationen aus Sicht des Backoffice
 * zusammen – der Webhook (`/api/integrations/emp-control/webhook`) bleibt der
 * primaere Sync-Pfad, hier wird nur manuell gepflegt.
 */

const EMPLOYEE_TICKET_TYPE = "Mitarbeiter";

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const status = url.searchParams.get("status"); // VALID | INVALID | EXPIRED | ""
  const areaId = url.searchParams.get("areaId");

  const where: Record<string, unknown> = {
    accountId: accountId!,
    source: "EMP_CONTROL",
  };

  if (status === "VALID" || status === "INVALID" || status === "PROTECTED") {
    where.status = status;
  }

  if (areaId && !Number.isNaN(Number(areaId))) {
    const id = Number(areaId);
    where.OR = [
      { accessAreaId: id },
      { ticketAreas: { some: { accessAreaId: id } } },
    ];
  }

  if (q) {
    // Ohne Tenant-zu-Tenant-Leak: case-insensitive Suche ueber Name/RFID/Email.
    where.AND = [
      ...((where.AND as unknown[]) ?? []),
      {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { rfidCode: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
    ];
  }

  const employees = await db.ticket.findMany({
    where: where as never,
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      rfidCode: true,
      email: true,
      startDate: true,
      endDate: true,
      status: true,
      profileImage: true,
      ticketTypeName: true,
      weekSchedule: true,
      accessAreaId: true,
      uuid: true,
      updatedAt: true,
      ticketAreas: {
        select: { accessAreaId: true, accessArea: { select: { name: true } } },
      },
      ticketDevices: {
        select: { deviceId: true, device: { select: { name: true, type: true } } },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { name: "asc" }],
    take: 1000,
  });

  // Letzter Scan pro Mitarbeiter – kompakt als sub-query je Mitarbeiter waere
  // teuer. Wir holen die letzten Scans in einem Aufruf und matchen client-seitig.
  const ids = employees.map((e) => e.id);
  const lastScans = ids.length
    ? await db.scan.findMany({
        where: { accountId: accountId!, ticketId: { in: ids } },
        select: { ticketId: true, scanTime: true, result: true, deviceId: true },
        orderBy: { scanTime: "desc" },
        take: ids.length * 3,
      })
    : [];
  const lastScanByTicket = new Map<number, { scanTime: Date; result: string; deviceId: number | null }>();
  for (const s of lastScans) {
    if (s.ticketId == null) continue;
    if (!lastScanByTicket.has(s.ticketId)) {
      lastScanByTicket.set(s.ticketId, { scanTime: s.scanTime, result: s.result, deviceId: s.deviceId });
    }
  }

  return NextResponse.json(
    employees.map((e) => ({
      id: e.id,
      name: e.name,
      firstName: e.firstName,
      lastName: e.lastName,
      rfidCode: e.rfidCode,
      email: e.email,
      startDate: e.startDate,
      endDate: e.endDate,
      status: e.status,
      profileImage: e.profileImage,
      ticketTypeName: e.ticketTypeName ?? EMPLOYEE_TICKET_TYPE,
      hasSchedule: !!e.weekSchedule,
      areas: e.ticketAreas.map((ta) => ({ id: ta.accessAreaId, name: ta.accessArea?.name ?? `#${ta.accessAreaId}` })),
      directDevices: e.ticketDevices.map((td) => ({ id: td.deviceId, name: td.device?.name ?? `#${td.deviceId}`, type: td.device?.type ?? null })),
      uuid: e.uuid,
      lastScan: lastScanByTicket.get(e.id) ?? null,
      updatedAt: e.updatedAt,
    })),
  );
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json();
  const parsed = employeeCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // UUID kollisionsfrei (sonst kann der EMP_CONTROL-Webhook nichts ueberschreiben)
  const uuid = `emp-manual-${randomBytes(6).toString("hex")}`;

  const created = await db.ticket.create({
    data: {
      accountId: accountId!,
      uuid,
      source: "EMP_CONTROL",
      name: data.name,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      rfidCode: data.rfidCode ?? null,
      email: data.email && data.email.length > 0 ? data.email : null,
      ticketTypeName: data.ticketTypeName ?? EMPLOYEE_TICKET_TYPE,
      profileImage: data.profileImage ?? null,
      startDate: data.startDate && data.startDate !== "" ? new Date(data.startDate) : null,
      endDate: data.endDate && data.endDate !== "" ? new Date(data.endDate) : null,
      status: data.status ?? "VALID",
      validityType: "DATE_RANGE",
      weekSchedule: data.weekSchedule ?? undefined,
      ticketAreas: data.areaIds && data.areaIds.length > 0 ? {
        create: data.areaIds.map((id) => ({ accessAreaId: id })),
      } : undefined,
      ticketDevices: data.deviceIds && data.deviceIds.length > 0 ? {
        create: data.deviceIds.map((id) => ({ deviceId: id })),
      } : undefined,
    },
  });

  return NextResponse.json({ id: created.id, uuid }, { status: 201 });
}
