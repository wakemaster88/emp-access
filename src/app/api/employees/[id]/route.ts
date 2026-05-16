import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { employeeUpdateSchema } from "@/lib/validators";

/**
 * Detail / Update / Delete eines Mitarbeiters (= Ticket mit source=EMP_CONTROL).
 *
 * Wichtig: Wir akzeptieren nur Tickets, die wirklich Mitarbeiter-Quelle haben,
 * damit ueber dieses Endpoint nicht versehentlich Kundentickets veraendert
 * werden koennen. Bereiche (`areaIds`) und Geraete (`deviceIds`) werden bei
 * Mitgabe komplett ersetzt; Wochenplan (`weekSchedule`) kann mit `null`
 * geloescht werden.
 */

async function loadEmployee(db: NonNullable<Awaited<ReturnType<typeof getSessionWithDb>>>["db"], id: number, accountId: number) {
  if (!db) return null;
  return db.ticket.findFirst({
    where: { id, accountId, source: "EMP_CONTROL" },
    include: {
      ticketAreas: {
        select: { accessAreaId: true, accessArea: { select: { id: true, name: true } } },
      },
      ticketDevices: {
        select: { deviceId: true, device: { select: { id: true, name: true, type: true, category: true } } },
      },
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const employeeId = Number(id);
  if (Number.isNaN(employeeId)) {
    return NextResponse.json({ error: "Ungueltige ID" }, { status: 400 });
  }

  const employee = await loadEmployee(db, employeeId, accountId!);
  if (!employee) return NextResponse.json({ error: "Mitarbeiter nicht gefunden" }, { status: 404 });

  return NextResponse.json({
    id: employee.id,
    uuid: employee.uuid,
    name: employee.name,
    firstName: employee.firstName,
    lastName: employee.lastName,
    rfidCode: employee.rfidCode,
    email: employee.email,
    ticketTypeName: employee.ticketTypeName,
    startDate: employee.startDate,
    endDate: employee.endDate,
    status: employee.status,
    profileImage: employee.profileImage,
    weekSchedule: employee.weekSchedule,
    accessAreaId: employee.accessAreaId,
    areaIds: employee.ticketAreas.map((ta) => ta.accessAreaId),
    deviceIds: employee.ticketDevices.map((td) => td.deviceId),
    directDevices: employee.ticketDevices.map((td) => td.device),
    areas: employee.ticketAreas.map((ta) => ta.accessArea),
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const employeeId = Number(id);
  if (Number.isNaN(employeeId)) {
    return NextResponse.json({ error: "Ungueltige ID" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = employeeUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await loadEmployee(db, employeeId, accountId!);
  if (!existing) return NextResponse.json({ error: "Mitarbeiter nicht gefunden" }, { status: 404 });

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.firstName !== undefined) updateData.firstName = data.firstName;
  if (data.lastName !== undefined) updateData.lastName = data.lastName;
  if (data.rfidCode !== undefined) updateData.rfidCode = data.rfidCode;
  if (data.email !== undefined) updateData.email = data.email && data.email.length > 0 ? data.email : null;
  if (data.ticketTypeName !== undefined) updateData.ticketTypeName = data.ticketTypeName;
  if (data.profileImage !== undefined) updateData.profileImage = data.profileImage;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.startDate !== undefined) {
    updateData.startDate = data.startDate && data.startDate !== "" ? new Date(data.startDate) : null;
  }
  if (data.endDate !== undefined) {
    updateData.endDate = data.endDate && data.endDate !== "" ? new Date(data.endDate) : null;
  }
  if (data.weekSchedule !== undefined) {
    // null = entfernen, sonst ersetzen
    updateData.weekSchedule = data.weekSchedule === null ? null : data.weekSchedule;
  }

  // Bereiche/Geraete-Whitelist: komplett ersetzen, wenn das Feld geschickt wurde.
  // Raw `prisma` mit manuellem set_config, weil der tenant-Extended Client
  // pro Query in eine eigene Transaktion wrappt (siehe lib/prisma.ts).
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${String(accountId)}, TRUE)`;

    if (Object.keys(updateData).length > 0) {
      await tx.ticket.update({ where: { id: employeeId }, data: updateData });
    }

    if (data.areaIds) {
      await tx.ticketArea.deleteMany({ where: { ticketId: employeeId } });
      if (data.areaIds.length > 0) {
        await tx.ticketArea.createMany({
          data: data.areaIds.map((accessAreaId) => ({ ticketId: employeeId, accessAreaId })),
          skipDuplicates: true,
        });
      }
      // accessAreaId (Haupt-Area) synchron halten: erstes Element oder null.
      await tx.ticket.update({
        where: { id: employeeId },
        data: { accessAreaId: data.areaIds[0] ?? null },
      });
    }

    if (data.deviceIds) {
      await tx.ticketDevice.deleteMany({ where: { ticketId: employeeId } });
      if (data.deviceIds.length > 0) {
        await tx.ticketDevice.createMany({
          data: data.deviceIds.map((deviceId) => ({ ticketId: employeeId, deviceId })),
          skipDuplicates: true,
        });
      }
    }
  });

  const updated = await loadEmployee(db, employeeId, accountId!);
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const employeeId = Number(id);
  if (Number.isNaN(employeeId)) {
    return NextResponse.json({ error: "Ungueltige ID" }, { status: 400 });
  }

  const existing = await loadEmployee(db, employeeId, accountId!);
  if (!existing) return NextResponse.json({ error: "Mitarbeiter nicht gefunden" }, { status: 404 });

  await db.ticket.delete({ where: { id: employeeId } });
  return NextResponse.json({ ok: true });
}
