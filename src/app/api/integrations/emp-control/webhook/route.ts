import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";
import { secretsEqual } from "@/lib/cron-auth";
import { isUniqueConstraintError } from "@/lib/db-errors";
import { FULL_SYNC_PREVIEW_MAX, isPresenceMarker, isSyncedEmployeeUuid, planFullSync } from "@/lib/emp-control-sync";

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
 *
 * Ein Eintrag mit `active: false` fuer einen Mitarbeiter, der hier noch kein
 * Ticket hat, wird uebersprungen (kein Ticket angelegt, nicht gezaehlt).
 *
 * Voll-Abgleich (nur Objektform): `{ "fullSync": true, "employees": [...] }`
 * heisst, die Liste ist vollstaendig (aktive und inaktive Mitarbeiter). Nach
 * der normalen Verarbeitung werden alle VALID-Tickets dieses Mandanten mit
 * Quelle EMP_CONTROL und uuid `emp-<id>` (nicht `emp-manual-…` aus dem
 * Dashboard), die nicht in der Liste stehen und seit Beginn des Aufrufs nicht
 * geaendert wurden, auf INVALID gesetzt; sonst bleibt am Ticket alles stehen. Antwort zusaetzlich
 * mit `deactivated` und `deactivatedIds`. Abgelehnt (409, `wouldDeactivate`)
 * wird der Abgleich bei leerer Liste, bei einem Eintrag ohne ID und, ausser
 * mit `fullSyncForce: true`, wenn mehr als 3 Tickets und mehr als 30 Prozent
 * der gueltigen Mitarbeiter-Tickets gesperrt wuerden (siehe
 * `src/lib/emp-control-sync.ts`). Fuer den taeglichen Abgleich reicht je
 * Mitarbeiter `{ "id": …, "active": true|false }`: Ein solcher Eintrag ohne
 * weitere Felder legt im Voll-Abgleich kein Ticket an und aendert an einem
 * vorhandenen nichts. Mit `active: false` gilt der Mitarbeiter als nicht
 * mehr gemeldet, sein gueltiges Ticket wird wie ein fehlendes gesperrt
 * (zaehlt bei den Schutzregeln mit und steht in `deactivatedIds`). Eine
 * Ablehnung nennt in `wouldDeactivateEmployees` (ID und Name, hoechstens 50)
 * die Mitarbeiter, deren Ticket gesperrt worden waere, damit der Absender
 * sie anzeigen kann.
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
      if (typeof extra.webhookSecret === "string" && secretsEqual(extra.webhookSecret, token)) {
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

  const bodyObject = !Array.isArray(body) && body != null && typeof body === "object"
    ? (body as { fullSync?: unknown; fullSyncForce?: unknown })
    : null;
  const fullSync = bodyObject?.fullSync === true;
  const fullSyncForce = bodyObject?.fullSyncForce === true;

  // Fuer den Voll-Abgleich: Zeitpunkt und Anzahl der gueltigen Webhook-Tickets
  // vor der Verarbeitung. Gesperrt werden nur Tickets, die seit diesem
  // Zeitpunkt nicht geaendert wurden (ein parallel eingetroffener Einzel-Sync
  // bleibt so stehen); der Nenner der Prozent-Regel zaehlt im selben Aufruf
  // neu angelegte Tickets nicht mit.
  const fullSyncStartedAt = new Date();
  const validBefore = fullSync
    ? (await db.ticket.findMany({
        where: { accountId, source: "EMP_CONTROL", status: "VALID" },
        select: { uuid: true },
      })).filter((t) => isSyncedEmployeeUuid(t.uuid)).length
    : 0;

  let created = 0;
  let updated = 0;
  /**
   * IDs, die emp-control geschickt hat, die es hier aber nicht gibt. Sie werden
   * uebersprungen statt den ganzen Aufruf abzulehnen – aber gemeldet: Sonst
   * fehlt einem Mitarbeiter stillschweigend die Freigabe, und niemand erfaehrt
   * warum.
   */
  const unknown: { employeeId: string; areaIds?: number[]; deviceIds?: number[] }[] = [];
  /**
   * Mitarbeiter, deren Ticket wegen eines eindeutigen Werts (Kennung oder
   * Code schon vergeben) nicht gespeichert werden konnte. Die uebrigen
   * Mitarbeiter laufen weiter; gemeldet wird je Mitarbeiter.
   */
  const failed: { employeeId: string; error: string }[] = [];

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

    const uuid = `emp-${id}`;
    const existing = await db.ticket.findFirst({ where: { uuid } });

    // Inaktiver Mitarbeiter ohne Ticket: nichts anlegen. Ein gesperrtes
    // Ticket fuer jemanden, der hier nie Zutritt hatte, braucht niemand.
    if (!existing && emp.active === false) continue;

    // Voll-Abgleich: Ein Eintrag nur mit ID (und active) ist eine reine
    // Anwesenheitsmeldung. Er legt nichts an und laesst ein vorhandenes
    // Ticket, wie es ist (Chip, Namen, Bereiche, Status). Mit active false
    // gilt der Mitarbeiter als nicht mehr gemeldet: Sein Ticket wird unten
    // zusammen mit den fehlenden gesperrt, unter denselben Schutzregeln.
    if (fullSync && isPresenceMarker(emp)) continue;

    if (areaUnknown.length > 0 || deviceUnknown.length > 0) {
      unknown.push({
        employeeId: String(id),
        ...(areaUnknown.length > 0 ? { areaIds: [...new Set(areaUnknown)] } : {}),
        ...(deviceUnknown.length > 0 ? { deviceIds: [...new Set(deviceUnknown)] } : {}),
      });
    }

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
    try {
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
    } catch (e) {
      if (!isUniqueConstraintError(e)) throw e;
      console.warn("[emp-control/webhook] Ticket nicht gespeichert (eindeutiger Wert vergeben)", { employeeId: String(id) });
      failed.push({ employeeId: String(id), error: "Kennung oder Code ist bereits vergeben" });
      continue;
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

  // Voll-Abgleich: Erst nach der Verarbeitung oben, damit gerade gemeldete
  // Mitarbeiter schon ihren neuen Stand haben. Gesperrt wird nur der Status
  // VALID; Bereiche, Geraete, Chip und Daten bleiben, ein spaeterer Aufruf
  // mit active true gibt das Ticket wieder frei.
  let fullSyncResult: { deactivated: number; deactivatedIds: string[] } | null = null;
  let fullSyncRefusal: {
    error: string;
    wouldDeactivate: number;
    wouldDeactivateEmployees: { id: string; name: string }[];
  } | null = null;
  if (fullSync) {
    const validTickets = await db.ticket.findMany({
      where: { accountId, source: "EMP_CONTROL", status: "VALID", updatedAt: { lt: fullSyncStartedAt } },
      select: { id: true, uuid: true, name: true },
    });
    const plan = planFullSync({ employees, validTickets, validBefore, force: fullSyncForce });
    if (plan.action === "refuse") {
      const names = new Map(validTickets.map((t) => [t.id, t.name]));
      fullSyncRefusal = {
        error: plan.error,
        wouldDeactivate: plan.wouldDeactivate,
        wouldDeactivateEmployees: plan.ticketIds.slice(0, FULL_SYNC_PREVIEW_MAX).map((ticketId, i) => ({
          id: plan.employeeIds[i],
          name: names.get(ticketId) ?? "",
        })),
      };
      console.info("[emp-control/webhook] Voll-Abgleich abgelehnt", {
        accountId,
        employees: employees.length,
        reason: plan.reason,
        wouldDeactivate: plan.wouldDeactivate,
        valid: plan.total,
      });
    } else {
      const changed = plan.ticketIds.length > 0
        ? await db.ticket.updateManyAndReturn({
            where: {
              id: { in: plan.ticketIds },
              accountId,
              source: "EMP_CONTROL",
              status: "VALID",
              updatedAt: { lt: fullSyncStartedAt },
            },
            data: { status: "INVALID" },
            select: { id: true, uuid: true },
          })
        : [];
      const deactivatedIds = changed
        .sort((a, b) => a.id - b.id)
        .map((t) => (t.uuid ?? "").slice(4));
      fullSyncResult = { deactivated: changed.length, deactivatedIds };
      console.info("[emp-control/webhook] Voll-Abgleich", {
        accountId,
        employees: employees.length,
        deactivated: changed.length,
      });
    }
  }

  await prisma.apiConfig.update({
    where: { id: config.id },
    data: { lastUpdate: new Date() },
  });

  // Konflikte sollen in emp-control sichtbar bleiben: Der Abgleich dort
  // wertet nur den HTTP-Status und das Feld error aus. Die uebrigen
  // Mitarbeiter sind zu diesem Zeitpunkt bereits gespeichert.
  if (fullSyncRefusal) {
    const failedText = failed.length > 0
      ? ` ${failed.length} Mitarbeiter nicht gespeichert, Kennung oder Code ist bereits vergeben (ID ${failed.map((f) => f.employeeId).join(", ")})`
      : "";
    return NextResponse.json(
      {
        ok: false,
        error: `${fullSyncRefusal.error}${failedText}`,
        wouldDeactivate: fullSyncRefusal.wouldDeactivate,
        wouldDeactivateEmployees: fullSyncRefusal.wouldDeactivateEmployees,
        created,
        updated,
        ...(unknown.length > 0 ? { unknown } : {}),
        ...(failed.length > 0 ? { failed } : {}),
      },
      { status: 409 },
    );
  }

  if (failed.length > 0) {
    const ids = failed.map((f) => f.employeeId).join(", ");
    return NextResponse.json(
      {
        ok: false,
        error: `${failed.length} Mitarbeiter nicht gespeichert, Kennung oder Code ist bereits vergeben (ID ${ids})`,
        created,
        updated,
        ...(unknown.length > 0 ? { unknown } : {}),
        failed,
        ...(fullSyncResult ?? {}),
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    created,
    updated,
    ...(unknown.length > 0 ? { unknown } : {}),
    ...(fullSyncResult ?? {}),
  });
}
