import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";

/**
 * Webhook für emp-control: Mitarbeiter per POST übermitteln.
 * Auth: Header "Authorization: Bearer <webhookSecret>" oder "X-Webhook-Secret: <webhookSecret>".
 * Body: { "employees": [ { "id", "firstName", "lastName", "rfidCode"|"cardId", "contractStart", "contractEnd", "active", "areaId"|"areaIds"|"resourceIds" } ] }
 * areaId / areaIds[0] / resourceIds[0] = AccessArea-ID (Ressource), bei der der Mitarbeiter Zugang hat. Optional.
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

    const rawAreaId = emp.areaId ?? emp.accessAreaId ?? (Array.isArray(emp.areaIds) ? emp.areaIds[0] : undefined) ?? (Array.isArray(emp.resourceIds) ? emp.resourceIds[0] : undefined);
    const accessAreaId =
      rawAreaId != null && validAreaIds.has(Number(rawAreaId)) ? Number(rawAreaId) : null;

    const uuid = `emp-${id}`;
    const existing = await db.ticket.findFirst({
      where: { uuid },
    });

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
      accessAreaId,
    };

    if (existing) {
      await db.ticket.update({
        where: { id: existing.id },
        data: ticketData,
      });
      updated++;
    } else {
      await db.ticket.create({
        data: { ...ticketData, uuid, accountId },
      });
      created++;
    }
  }

  await prisma.apiConfig.update({
    where: { id: config.id },
    data: { lastUpdate: new Date() },
  });

  return NextResponse.json({ ok: true, created, updated });
}
