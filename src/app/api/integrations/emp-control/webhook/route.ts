import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";

/**
 * Webhook für emp-control: Mitarbeiter per POST übermitteln.
 * Auth: Header "Authorization: Bearer <webhookSecret>" oder "X-Webhook-Secret: <webhookSecret>".
 * Body: { "employees": [ { "id", "firstName", "lastName", "rfidCode"|"cardId", "contractStart", "contractEnd", "active", "areaId"|"areaIds"|"resourceIds" } ] }
 * areaId  = einzelne AccessArea-ID
 * areaIds / resourceIds = Array von AccessArea-IDs (Mitarbeiter hat Zugang zu mehreren Bereichen)
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const secretHeader = request.headers.get("x-webhook-secret");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : secretHeader?.trim();

  if (!token) {
    return NextResponse.json({ error: "Missing webhook secret (Authorization: Bearer … or X-Webhook-Secret)" }, { status: 401 });
  }

  const configs = await prisma.apiConfig.findMany({
    where: { provider: "EMP_CONTROL" },
  });

  let config: (typeof configs)[0] | null = null;
  for (const c of configs) {
    try {
      const extra = c.extraConfig ? JSON.parse(c.extraConfig) : {};
      if (extra.webhookSecret === token) {
        config = c;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!config) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  const accountId = config.accountId;
  const db = tenantClient(accountId);

  const validAreaIds = new Set(
    (await db.accessArea.findMany({ where: { accountId }, select: { id: true } })).map((a) => a.id)
  );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const employees = Array.isArray(body)
    ? body
    : (body as { employees?: unknown[] }).employees;
  if (!Array.isArray(employees)) {
    return NextResponse.json(
      { error: "Body must be an array of employees or { employees: [...] }" },
      { status: 400 }
    );
  }

  let created = 0;
  let updated = 0;

  for (const emp of employees) {
    const id = emp.id ?? emp.employeeId;
    if (id == null) continue;

    const rawIds: number[] = [];
    if (Array.isArray(emp.areaIds)) {
      for (const a of emp.areaIds) if (validAreaIds.has(Number(a))) rawIds.push(Number(a));
    }
    if (Array.isArray(emp.resourceIds)) {
      for (const a of emp.resourceIds) if (validAreaIds.has(Number(a))) rawIds.push(Number(a));
    }
    if (emp.areaId != null && validAreaIds.has(Number(emp.areaId))) rawIds.push(Number(emp.areaId));
    if (emp.accessAreaId != null && validAreaIds.has(Number(emp.accessAreaId))) rawIds.push(Number(emp.accessAreaId));
    const areaIds = [...new Set(rawIds)];
    const primaryAreaId = areaIds[0] ?? null;

    const uuid = `emp-${id}`;
    const existing = await db.ticket.findFirst({ where: { uuid } });

    const ticketData = {
      name: `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim() || String(id),
      rfidCode: emp.rfidCode ?? emp.cardId ?? null,
      firstName: emp.firstName ?? null,
      lastName: emp.lastName ?? null,
      startDate: emp.contractStart ? new Date(emp.contractStart) : null,
      endDate: emp.contractEnd ? new Date(emp.contractEnd) : null,
      status: emp.active !== false ? ("VALID" as const) : ("INVALID" as const),
      ticketTypeName: "Mitarbeiter",
      source: "EMP_CONTROL" as const,
      accessAreaId: primaryAreaId,
    };

    let ticketId: number;
    if (existing) {
      await db.ticket.update({ where: { id: existing.id }, data: ticketData });
      ticketId = existing.id;
      updated++;
    } else {
      const t = await db.ticket.create({ data: { ...ticketData, uuid, accountId } });
      ticketId = t.id;
      created++;
    }

    if (areaIds.length > 0) {
      await db.ticketArea.deleteMany({ where: { ticketId } });
      await db.ticketArea.createMany({
        data: areaIds.map((accessAreaId) => ({ ticketId, accessAreaId })),
        skipDuplicates: true,
      });
    }
  }

  await prisma.apiConfig.update({
    where: { id: config.id },
    data: { lastUpdate: new Date() },
  });

  return NextResponse.json({ ok: true, created, updated });
}
