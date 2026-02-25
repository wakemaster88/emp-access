import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;

  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "EMP_CONTROL" },
  });

  if (!config) {
    return NextResponse.json({ error: "emp-control not configured" }, { status: 404 });
  }

  try {
    const baseUrl = config.baseUrl || "http://localhost:4000";
    const res = await fetch(`${baseUrl}/api/employees`, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `emp-control error: ${res.status}` },
        { status: 502 }
      );
    }

    const employees = await res.json();
    let created = 0;
    let updated = 0;

    for (const emp of Array.isArray(employees) ? employees : employees.data || []) {
      const uuid = `emp-${emp.id}`;
      const existing = await db.ticket.findFirst({ where: { uuid } });

      const ticketData = {
        name: `${emp.firstName || ""} ${emp.lastName || ""}`.trim(),
        rfidCode: emp.rfidCode || emp.cardId,
        firstName: emp.firstName,
        lastName: emp.lastName,
        startDate: emp.contractStart ? new Date(emp.contractStart) : undefined,
        endDate: emp.contractEnd ? new Date(emp.contractEnd) : undefined,
        status: emp.active !== false ? ("VALID" as const) : ("INVALID" as const),
        ticketTypeName: "Mitarbeiter",
        source: "EMP_CONTROL" as const,
      };

      if (existing) {
        await db.ticket.update({ where: { id: existing.id }, data: ticketData });
        updated++;
      } else {
        await db.ticket.create({
          data: { ...ticketData, uuid, accountId: accountId! },
        });
        created++;
      }
    }

    await db.apiConfig.update({
      where: { id: config.id },
      data: { lastUpdate: new Date() },
    });

    return NextResponse.json({ synced: { created, updated } });
  } catch (err) {
    return NextResponse.json(
      { error: `Import failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;

  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "EMP_CONTROL" },
  });

  if (!config) {
    return NextResponse.json({ error: "emp-control not configured" }, { status: 404 });
  }

  const since = config.lastPostUpdate
    ? config.lastPostUpdate
    : new Date(Date.now() - 24 * 60 * 60 * 1000);

  const scans = await db.scan.findMany({
    where: {
      accountId: accountId!,
      scanTime: { gte: since },
      ticket: { source: "EMP_CONTROL" },
    },
    include: { device: true, ticket: true },
    orderBy: { scanTime: "asc" },
  });

  if (scans.length === 0) {
    return NextResponse.json({ exported: 0 });
  }

  const payload = scans.map((s) => ({
    employeeId: s.ticket?.uuid?.replace("emp-", ""),
    rfidCode: s.code,
    scanTime: s.scanTime.toISOString(),
    direction: s.device.accessIn ? "IN" : s.device.accessOut ? "OUT" : "UNKNOWN",
    granted: s.result === "GRANTED" || s.result === "PROTECTED",
    deviceName: s.device.name,
  }));

  try {
    const baseUrl = config.baseUrl || "http://localhost:4000";
    const res = await fetch(`${baseUrl}/api/access-logs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scans: payload }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `emp-control error: ${res.status}` },
        { status: 502 }
      );
    }

    await db.apiConfig.update({
      where: { id: config.id },
      data: { lastPostUpdate: new Date() },
    });

    return NextResponse.json({ exported: payload.length });
  } catch (err) {
    return NextResponse.json(
      { error: `Export failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }
}
