/**
 * Pruefung der gemeinsamen Bulk-Erstellung (`src/lib/ticket-bulk.ts`) gegen
 * eine nachgebaute Datenbank. Wichtig sind die Faelle, die ueber den
 * Shop-Monitor-Token erreichbar werden: Mandantengrenzen und Code-Konflikte.
 *
 * Ausfuehren: npx tsx scripts/bulk-check.ts
 */

import { createTicketBulk } from "../src/lib/ticket-bulk";

const ACCOUNT = 1;
const OTHER_ACCOUNT = 2;

interface Row {
  id: number;
  accountId: number;
  name: string;
  barcode: string | null;
  qrCode: string | null;
  rfidCode: string | null;
  ticketTypeName: string | null;
  startDate: Date | null;
  endDate: Date | null;
  slotStart: string | null;
  slotEnd: string | null;
  accessAreaId: number | null;
  serviceId: number | null;
  subscriptionId: number | null;
  bulkBatchId: string | null;
  validityType: string;
  validityDurationMinutes: number | null;
}

function makeDb(seed: Partial<Row>[] = []) {
  let nextId = 100;
  const tickets: Row[] = seed.map((s, i) => ({
    id: i + 1,
    accountId: ACCOUNT,
    name: "seed",
    barcode: null,
    qrCode: null,
    rfidCode: null,
    ticketTypeName: null,
    startDate: null,
    endDate: null,
    slotStart: null,
    slotEnd: null,
    accessAreaId: null,
    serviceId: null,
    subscriptionId: null,
    bulkBatchId: null,
    validityType: "DATE_RANGE",
    validityDurationMinutes: null,
    ...s,
  }));

  const db = {
    tickets,
    ticket: {
      async findMany({ where }: { where: { accountId: number; OR: Array<Record<string, { in: string[] }>> } }) {
        return tickets.filter((t) => {
          if (t.accountId !== where.accountId) return false;
          return where.OR.some((cond) => {
            const [field, val] = Object.entries(cond)[0] as [keyof Row, { in: string[] }];
            const cur = t[field];
            return typeof cur === "string" && val.in.includes(cur);
          });
        });
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const barcode = (data.barcode as string) ?? null;
        // Globale Unique-Bedingung auf Ticket.barcode nachbilden.
        if (barcode && tickets.some((t) => t.barcode === barcode)) {
          throw new Error("Unique constraint failed on the fields: (`barcode`)");
        }
        const row: Row = {
          id: nextId++,
          accountId: data.accountId as number,
          name: data.name as string,
          barcode,
          qrCode: (data.qrCode as string) ?? null,
          rfidCode: (data.rfidCode as string) ?? null,
          ticketTypeName: (data.ticketTypeName as string) ?? null,
          startDate: (data.startDate as Date) ?? null,
          endDate: (data.endDate as Date) ?? null,
          slotStart: (data.slotStart as string) ?? null,
          slotEnd: (data.slotEnd as string) ?? null,
          accessAreaId: (data.accessAreaId as number) ?? null,
          serviceId: (data.serviceId as number) ?? null,
          subscriptionId: (data.subscriptionId as number) ?? null,
          bulkBatchId: (data.bulkBatchId as string) ?? null,
          validityType: (data.validityType as string) ?? "DATE_RANGE",
          validityDurationMinutes: (data.validityDurationMinutes as number) ?? null,
        };
        tickets.push(row);
        return row;
      },
    },
    service: {
      async findFirst({ where }: { where: { id: number; accountId: number } }) {
        // Service 10 gehoert Mandant 1, Service 99 einem anderen.
        const owner = where.id === 99 ? OTHER_ACCOUNT : ACCOUNT;
        return owner === where.accountId ? { id: where.id } : null;
      },
    },
    subscription: {
      async findFirst({ where }: { where: { id: number; accountId: number } }) {
        const owner = where.id === 99 ? OTHER_ACCOUNT : ACCOUNT;
        return owner === where.accountId ? { id: where.id } : null;
      },
    },
    serviceArea: {
      async findMany() {
        return [{ accessAreaId: 5 }, { accessAreaId: 6 }];
      },
    },
    accessArea: {
      async findFirst({ where }: { where: { id: number; accountId: number } }) {
        const owner = where.id === 99 ? OTHER_ACCOUNT : ACCOUNT;
        return owner === where.accountId ? { name: `Bereich ${where.id}` } : null;
      },
    },
  };

  return db;
}

type MockDb = ReturnType<typeof makeDb>;

/**
 * Der Mock deckt nur die Delegates ab, die die Bulk-Logik anfasst. Die
 * Umdeutung auf den Prisma-Typ passiert genau hier, damit der Mock selbst
 * einfache Funktionstypen behaelt und sich veraendern laesst.
 */
function asDb(mock: MockDb): Parameters<typeof createTicketBulk>[0] {
  return mock as unknown as Parameters<typeof createTicketBulk>[0];
}

let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FEHL "} ${label}${detail ? ` – ${detail}` : ""}`);
  if (!ok) failed++;
}

async function main() {
  // 1) PRINT-Bulk erzeugt eindeutige Barcodes und eine gemeinsame Batch-ID.
  {
    const db = makeDb();
    const res = await createTicketBulk(asDb(db), ACCOUNT, { count: 25, namePrefix: "Tagesgast" });
    check("PRINT: Ergebnis ok", res.ok);
    if (res.ok) {
      const codes = new Set(res.tickets.map((t) => t.barcode));
      check("PRINT: 25 Tickets", res.tickets.length === 25, `${res.tickets.length}`);
      check("PRINT: Barcodes eindeutig", codes.size === 25, `${codes.size} verschiedene`);
      check("PRINT: Name durchnummeriert", res.tickets[0].name === "Tagesgast 1" && res.tickets[24].name === "Tagesgast 25");
      check("PRINT: kein RFID gesetzt", res.tickets.every((t) => t.rfidCode == null));
      check("PRINT: eine Batch-ID", new Set(db.tickets.map((t) => t.bulkBatchId)).size === 1);
      check("PRINT: Kind korrekt", res.kind === "PRINT");
    }
  }

  // 2) Barcode-Kollision wird durch einen neuen Code aufgeloest, nicht
  //    durch einen Abbruch.
  {
    const db = makeDb();
    const original = db.ticket.create.bind(db.ticket);
    let first = true;
    // Erster Versuch kollidiert kuenstlich, danach normal weiter.
    db.ticket.create = async (args) => {
      if (first) {
        first = false;
        throw new Error("Unique constraint failed on the fields: (`barcode`)");
      }
      return original(args);
    };
    const res = await createTicketBulk(asDb(db), ACCOUNT, { count: 3 });
    check("PRINT: Kollision wird neu gewuerfelt", res.ok && res.tickets.length === 3);
  }

  // 3) RFID-Bulk: ein Ticket je Code, Duplikate im Batch fallen raus.
  {
    const db = makeDb();
    const res = await createTicketBulk(asDb(db), ACCOUNT, {
      rfidCodes: ["AAA", "BBB", " AAA ", "CCC"],
      namePrefix: "Bändchen",
    });
    check("RFID: Ergebnis ok", res.ok);
    if (res.ok) {
      check("RFID: Duplikat entfernt", res.tickets.length === 3, `${res.tickets.length} Tickets`);
      check("RFID: Codes gesetzt", res.tickets.map((t) => t.rfidCode).join(",") === "AAA,BBB,CCC");
      check("RFID: kein Barcode", res.tickets.every((t) => t.barcode === ""));
      check("RFID: Name enthaelt Code", res.tickets[0].name === "Bändchen AAA");
      check("RFID: Kind korrekt", res.kind === "RFID");
    }
  }

  // 4) Bereits vergebener RFID-Code bricht ab, bevor irgendetwas entsteht.
  {
    const db = makeDb([{ rfidCode: "AAA", name: "Bestand" }]);
    const before = db.tickets.length;
    const res = await createTicketBulk(asDb(db), ACCOUNT, { rfidCodes: ["AAA", "BBB"] });
    check("RFID-Konflikt: abgelehnt", !res.ok && res.status === 409);
    if (!res.ok) {
      const err = res.body.error as { code?: string; conflictCodes?: string[] };
      check("RFID-Konflikt: Code gemeldet", err.code === "CODE_CONFLICT" && err.conflictCodes?.[0] === "AAA");
    }
    check("RFID-Konflikt: nichts angelegt", db.tickets.length === before, `${db.tickets.length - before} neue Zeilen`);
  }

  // 5) Konflikt zaehlt auch, wenn der Code als QR oder Barcode vergeben ist.
  {
    const db = makeDb([{ qrCode: "QR1" }, { barcode: "BC1" }]);
    const res1 = await createTicketBulk(asDb(db), ACCOUNT, { rfidCodes: ["QR1"] });
    const res2 = await createTicketBulk(asDb(db), ACCOUNT, { rfidCodes: ["BC1"] });
    check("RFID-Konflikt: QR-Code erkannt", !res1.ok && res1.status === 409);
    check("RFID-Konflikt: Barcode erkannt", !res2.ok && res2.status === 409);
  }

  // 6) Fremde Referenzen werden abgewiesen – die entscheidende Grenze fuer
  //    den oeffentlichen Monitor-Token.
  {
    const db = makeDb();
    const svc = await createTicketBulk(asDb(db), ACCOUNT, { count: 1, serviceId: 99 });
    const sub = await createTicketBulk(asDb(db), ACCOUNT, { count: 1, subscriptionId: 99 });
    const area = await createTicketBulk(asDb(db), ACCOUNT, { count: 1, accessAreaId: 99 });
    check("Fremder Service abgelehnt", !svc.ok && svc.status === 400);
    check("Fremdes Abo abgelehnt", !sub.ok && sub.status === 400);
    check("Fremder Bereich abgelehnt", !area.ok && area.status === 400);
    check("Fremdreferenz: nichts angelegt", db.tickets.length === 0, `${db.tickets.length} Zeilen`);
  }

  // 7) Eigener Service: Ticket erhaelt Typ, Bereich und Service-Bereiche.
  {
    const db = makeDb();
    const res = await createTicketBulk(asDb(db), ACCOUNT, {
      count: 2,
      serviceId: 10,
      ticketTypeName: "Tageskarte",
      accessAreaId: 5,
      validityType: "DURATION",
      validityDurationMinutes: 60,
    });
    check("Service-Bulk ok", res.ok);
    if (res.ok) {
      check("Service-Bulk: Typ gesetzt", res.tickets.every((t) => t.ticketTypeName === "Tageskarte"));
      check("Service-Bulk: Bereichsname aufgeloest", res.tickets[0].accessAreaName === "Bereich 5");
      check("Service-Bulk: Dauer uebernommen", res.tickets[0].validityDurationMinutes === 60);
    }
  }

  // 8) Nur leere RFID-Codes ergeben eine klare Fehlermeldung statt 0 Tickets.
  {
    const db = makeDb();
    const res = await createTicketBulk(asDb(db), ACCOUNT, { rfidCodes: ["  ", ""] });
    check("Leere RFID-Liste abgelehnt", !res.ok && res.status === 400);
  }

  console.log(failed === 0 ? "\nAlle Pruefungen bestanden." : `\n${failed} Pruefung(en) fehlgeschlagen.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
