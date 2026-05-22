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

    // Bereiche (alle moeglichen Aliase mergen). Leere Liste bedeutet
    // "Webhook hat keine Areas mitgeschickt" - dann lassen wir die
    // bestehenden Bereiche stehen, statt sie zu loeschen (vgl. rfidCode).
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
    const areasInPayload =
      Array.isArray(emp.areaIds)
      || Array.isArray(emp.resourceIds)
      || emp.areaId != null
      || emp.accessAreaId != null;

    const uuid = `emp-${id}`;
    const existing = await db.ticket.findFirst({ where: { uuid } });

    // Inkrementeller Sync: Nur Felder schreiben, die der Webhook
    // tatsaechlich mitgeschickt hat. Frueher hat ein Sync ohne
    // `rfidCode`-Feld den vorhandenen RFID-Code auf NULL gesetzt - mit
    // dem Effekt, dass alle Mitarbeiter-Baendchen wertlos wurden, sobald
    // EMP-Control nur die Stammdaten resyncht hat (Vertragsverlaengerung
    // etc.). Jetzt gilt: kein Feld im Payload = bestehender Wert bleibt.
    const rfidCodeRaw = emp.rfidCode ?? emp.cardId;
    const hasRfidField = rfidCodeRaw !== undefined;
    const hasFirstName = emp.firstName !== undefined;
    const hasLastName = emp.lastName !== undefined;
    const hasName = hasFirstName || hasLastName;
    const hasContractStart = emp.contractStart !== undefined;
    const hasContractEnd = emp.contractEnd !== undefined;
    const hasActive = emp.active !== undefined;

    const fullName = `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim() || String(id);

    type TicketUpdate = {
      name?: string;
      rfidCode?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      startDate?: Date | null;
      endDate?: Date | null;
      status?: "VALID" | "INVALID";
      ticketTypeName?: string;
      source?: "EMP_CONTROL";
      accessAreaId?: number | null;
    };

    const updateData: TicketUpdate = { source: "EMP_CONTROL", ticketTypeName: "Mitarbeiter" };
    if (hasName) updateData.name = fullName;
    if (hasRfidField) updateData.rfidCode = rfidCodeRaw === null ? null : String(rfidCodeRaw);
    if (hasFirstName) updateData.firstName = emp.firstName ?? null;
    if (hasLastName) updateData.lastName = emp.lastName ?? null;
    if (hasContractStart) updateData.startDate = emp.contractStart ? new Date(emp.contractStart) : null;
    if (hasContractEnd) updateData.endDate = emp.contractEnd ? new Date(emp.contractEnd) : null;
    if (hasActive) updateData.status = emp.active !== false ? "VALID" : "INVALID";
    // accessAreaId nur ueberschreiben, wenn der Webhook explizit Areas
    // sendet. Sendet er gar keine Areas mit, lassen wir den bisherigen
    // Wert in Ruhe.
    if (areasInPayload) updateData.accessAreaId = primaryAreaId;

    let ticketId: number;
    if (existing) {
      if (Object.keys(updateData).length > 0) {
        await db.ticket.update({ where: { id: existing.id }, data: updateData });
      }
      ticketId = existing.id;
      updated++;
    } else {
      // Neuanlage: vollstaendige Defaults setzen, damit das Ticket
      // konsistent startet.
      const t = await db.ticket.create({
        data: {
          uuid,
          accountId,
          name: fullName,
          rfidCode: hasRfidField ? (rfidCodeRaw === null ? null : String(rfidCodeRaw)) : null,
          firstName: emp.firstName ?? null,
          lastName: emp.lastName ?? null,
          startDate: hasContractStart && emp.contractStart ? new Date(emp.contractStart) : null,
          endDate: hasContractEnd && emp.contractEnd ? new Date(emp.contractEnd) : null,
          status: emp.active !== false ? "VALID" : "INVALID",
          ticketTypeName: "Mitarbeiter",
          source: "EMP_CONTROL",
          accessAreaId: primaryAreaId,
        },
      });
      ticketId = t.id;
      created++;
    }

    // Areas-Sync ist nicht-destruktiv: Wenn der Webhook keine Areas
    // mitgeschickt hat (areasInPayload=false), wird die bestehende
    // ticketArea-Liste nicht angefasst. Sendet er eine leere Liste,
    // bedeutet das "alle Bereiche entfernen" - das ist legitim.
    if (areasInPayload) {
      await db.ticketArea.deleteMany({ where: { ticketId } });
      if (areaIds.length > 0) {
        await db.ticketArea.createMany({
          data: areaIds.map((accessAreaId) => ({ ticketId, accessAreaId })),
          skipDuplicates: true,
        });
      }
    }
  }

  await prisma.apiConfig.update({
    where: { id: config.id },
    data: { lastUpdate: new Date() },
  });

  return NextResponse.json({ ok: true, created, updated });
}
