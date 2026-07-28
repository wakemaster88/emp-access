import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";

/**
 * Zahlen aus einem Payload-Feld einsammeln und dabei in bekannt und unbekannt
 * trennen. Nimmt einzelne Werte genauso wie Listen, weil emp-control je Feld
 * beides schickt (`areaId` und `areaIds`).
 */
function collectIds(
  value: unknown,
  valid: Set<number>,
  known: number[],
  unknown: number[],
): void {
  const items = Array.isArray(value) ? value : value != null ? [value] : [];
  for (const raw of items) {
    const n = Number(raw);
    if (!Number.isInteger(n)) continue;
    (valid.has(n) ? known : unknown).push(n);
  }
}

/**
 * Webhook für emp-control: Mitarbeiter per POST übermitteln.
 * Auth: Header "Authorization: Bearer <webhookSecret>" oder "X-Webhook-Secret: <webhookSecret>".
 * Body: { "employees": [ { "id", "firstName", "lastName", "rfidCode"|"cardId", "contractStart", "contractEnd", "active", "areaId"|"areaIds"|"resourceIds", "deviceId"|"deviceIds" } ] }
 * areaId  = einzelne AccessArea-ID
 * areaIds / resourceIds = Array von AccessArea-IDs (Mitarbeiter hat Zugang zu mehreren Bereichen)
 * deviceId / deviceIds = einzelne Geraete, die dieser Mitarbeiter zusaetzlich
 *   bedienen darf – gedacht fuer den Fall, dass jemand genau eine Tuer braucht,
 *   ohne dafuer einen eigenen Bereich anzulegen. Wirkt additiv zu den Bereichen
 *   und gilt in der Mitarbeiter-App wie am RFID-Leser. IDs kommen aus
 *   `GET /api/devices`.
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
  // Auch abgeschaltete Geraete zaehlen als gueltig: Die Zuweisung darf schon
  // stehen, bevor ein Geraet in Betrieb geht. Ob es tatsaechlich erscheint,
  // entscheidet spaeter `isActive` beim Auflesen der Zugriffsrechte.
  const validDeviceIds = new Set(
    (await db.device.findMany({ where: { accountId }, select: { id: true } })).map((d) => d.id)
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
  /**
   * IDs, die emp-control geschickt hat, die es hier aber nicht gibt. Sie werden
   * uebersprungen statt den ganzen Aufruf abzulehnen – aber gemeldet: Sonst
   * fehlt einem Mitarbeiter stillschweigend die Freigabe, und niemand erfaehrt
   * warum.
   */
  const unknown: { employeeId: string; areaIds?: number[]; deviceIds?: number[] }[] = [];

  for (const emp of employees) {
    const id = emp.id ?? emp.employeeId;
    if (id == null) continue;

    // Bereiche (alle moeglichen Aliase mergen). Leere Liste bedeutet
    // "Webhook hat keine Areas mitgeschickt" - dann lassen wir die
    // bestehenden Bereiche stehen, statt sie zu loeschen (vgl. rfidCode).
    const areaKnown: number[] = [];
    const areaUnknown: number[] = [];
    collectIds(emp.areaIds, validAreaIds, areaKnown, areaUnknown);
    collectIds(emp.resourceIds, validAreaIds, areaKnown, areaUnknown);
    collectIds(emp.areaId, validAreaIds, areaKnown, areaUnknown);
    collectIds(emp.accessAreaId, validAreaIds, areaKnown, areaUnknown);
    const areaIds = [...new Set(areaKnown)];
    const primaryAreaId = areaIds[0] ?? null;
    const areasInPayload =
      Array.isArray(emp.areaIds)
      || Array.isArray(emp.resourceIds)
      || emp.areaId != null
      || emp.accessAreaId != null;

    // Einzelne Geraete, zusaetzlich zu den Bereichen. Dieselbe Regel wie oben:
    // Feld fehlt = bestehende Zuweisung bleibt, leere Liste = alle entfernen.
    const deviceKnown: number[] = [];
    const deviceUnknown: number[] = [];
    collectIds(emp.deviceIds, validDeviceIds, deviceKnown, deviceUnknown);
    collectIds(emp.deviceId, validDeviceIds, deviceKnown, deviceUnknown);
    const deviceIds = [...new Set(deviceKnown)];
    const devicesInPayload = Array.isArray(emp.deviceIds) || emp.deviceId != null;

    if (areaUnknown.length > 0 || deviceUnknown.length > 0) {
      unknown.push({
        employeeId: String(id),
        ...(areaUnknown.length > 0 ? { areaIds: [...new Set(areaUnknown)] } : {}),
        ...(deviceUnknown.length > 0 ? { deviceIds: [...new Set(deviceUnknown)] } : {}),
      });
    }

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

    // Direkt zugewiesene Geraete, nach derselben Regel wie die Bereiche.
    if (devicesInPayload) {
      await db.ticketDevice.deleteMany({ where: { ticketId } });
      if (deviceIds.length > 0) {
        await db.ticketDevice.createMany({
          data: deviceIds.map((deviceId) => ({ ticketId, deviceId })),
          skipDuplicates: true,
        });
      }
    }
  }

  await prisma.apiConfig.update({
    where: { id: config.id },
    data: { lastUpdate: new Date() },
  });

  return NextResponse.json({
    ok: true,
    created,
    updated,
    ...(unknown.length > 0 ? { unknown } : {}),
  });
}
