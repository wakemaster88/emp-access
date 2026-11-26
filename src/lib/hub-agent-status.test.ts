import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma, type PrismaClient } from "@prisma/client";
import { mergeHubStatus } from "./hub-status";
import { writeHubAgentStatus } from "./hub-agent-status";

/*
 * Die Anweisung, mit der Heartbeat, Parkmeldung und Switch-Upload den Status
 * schreiben, ohne Datenbank: Die Attrappe nimmt den Aufruf von $queryRaw
 * entgegen und setzt ihn so zusammen, wie Prisma ihn an Postgres schickt
 * (Text mit $1, $2 … und die Werte daneben).
 */
function fakeDb(rows: Array<{ id: number }> = [{ id: 7 }]) {
  const calls: Prisma.Sql[] = [];
  const db = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(Prisma.sql(strings, ...values));
      return Promise.resolve(rows);
    },
  } as unknown as PrismaClient;
  return { db, calls };
}

/** Wert des Platzhalters, der im Text fuer Postgres auf `before` folgt (z. B. `"accountId" = `). */
function valueAfter(q: Prisma.Sql, before: string): unknown {
  const at = q.text.indexOf(before);
  assert.ok(at >= 0, `"${before}" fehlt`);
  const m = /^\$(\d+)/.exec(q.text.slice(at + before.length));
  assert.ok(m, `kein Platzhalter nach "${before}"`);
  return q.values[Number(m[1]) - 1];
}

/** Text der Anweisung fuer Postgres ($1, $2 …), Leerraum zusammengefasst. */
const flat = (q: Prisma.Sql) => q.text.replace(/\s+/g, " ").trim();

test("writeHubAgentStatus: eine Anweisung, Zeile anlegen oder nur den Schluessel des Schreibers ersetzen", async () => {
  const { db, calls } = fakeDb();
  const patch = { parking: { at: "2026-11-25T10:00:00.000Z", trackerOnline: true, lots: [] } };
  assert.equal(await writeHubAgentStatus(db, 3, "Hub Halle", patch), 7);
  assert.equal(calls.length, 1);
  const q = calls[0];
  const sql = flat(q);
  assert.match(sql, /^INSERT INTO "HubAgent" \("name", "accountId", "status", "lastSeenAt", "updatedAt"\) VALUES \(/);
  assert.match(sql, /ON CONFLICT \("accountId", "name"\) DO UPDATE SET "status" = /);
  assert.match(sql, /RETURNING "id"$/);
  // Immer an das Konto gebunden, auch beim Aendern der vorhandenen Zeile.
  assert.equal(valueAfter(q, `WHERE "HubAgent"."accountId" = `), 3);
  // Bestehender Status (kein Objekt: neues Objekt) || Patch, nichts gelesen und nichts zurueck.
  assert.match(sql, /CASE WHEN jsonb_typeof\("HubAgent"\."status"\) = 'object' THEN "HubAgent"\."status" ELSE '\{\}'::jsonb END\) \|\| \$\d+::jsonb/);
  assert.doesNotMatch(sql, /RETURNING .*status/);
  // Altbestand: eine Port-Liste oder eine MAC-Tabelle allein reicht zum Kuerzen (wie hasSnmpDetail).
  assert.ok(sql.includes(`WHERE jsonb_typeof(e -> 'ports') = 'array' OR jsonb_typeof(e -> 'macTable') = 'array'`));
  // Werte nur als Parameter: Name, Konto und der aufbereitete Patch.
  assert.ok(q.values.includes("Hub Halle"));
  assert.ok(q.values.includes(JSON.stringify(mergeHubStatus(null, patch))));
  assert.doesNotMatch(sql, /hostname|version|modules/);
});

test("writeHubAgentStatus: Eingaben stehen nie im Text der Anweisung", async () => {
  const { db, calls } = fakeDb();
  const evil = `x'); DROP TABLE "HubAgent"; --`;
  await writeHubAgentStatus(db, 1, evil, { [evil]: evil, snmp: { switches: [{ host: evil, ports: [], macTable: [] }] } }, {
    hostname: evil,
    version: evil,
    modules: { [evil]: true },
  });
  const q = calls[0];
  assert.ok(!q.text.includes("DROP TABLE"), q.text);
  assert.ok(q.values.includes(evil));
  // Der Patch kommt schon gekuerzt in die Anweisung (keine Port-Listen).
  const json = q.values.find((v) => typeof v === "string" && v.includes('"snmp"')) as string;
  assert.deepEqual(JSON.parse(json).snmp.switches, [
    { host: evil, sysName: null, polledAt: null, ports: 0, portsUp: 0, macs: 0, error: null },
  ]);
});

test("writeHubAgentStatus: Heartbeat setzt Rechnername, Version und Module; ohne Module bleibt der gespeicherte Wert", async () => {
  const { db, calls } = fakeDb();
  await writeHubAgentStatus(db, 2, "Hub", { system: { autoLogin: true } }, { hostname: "mac", version: "1.2", modules: ["kameras"] });
  await writeHubAgentStatus(db, 2, "Hub", { system: { autoLogin: true } }, { hostname: "mac", version: "1.2", modules: undefined });
  for (const q of calls) {
    const sql = flat(q);
    assert.match(sql, /\("name", "accountId", "status", "lastSeenAt", "updatedAt", "hostname", "version", "modules"\)/);
    assert.match(sql, /"hostname" = EXCLUDED\."hostname", "version" = EXCLUDED\."version", "modules" = COALESCE\(EXCLUDED\."modules", "HubAgent"\."modules"\)/);
    assert.equal(valueAfter(q, `WHERE "HubAgent"."accountId" = `), 2);
    assert.ok(q.values.includes("mac") && q.values.includes("1.2"));
  }
  assert.ok(calls[0].values.includes(JSON.stringify(["kameras"])));
  // modules undefined: NULL in die neue Zeile, COALESCE behaelt den alten Wert.
  assert.ok(!calls[1].values.some((v) => typeof v === "string" && v.includes("kameras")));
  assert.ok(calls[1].values.includes(null));
});

test("writeHubAgentStatus: ohne Zeile in der Antwort 0", async () => {
  const { db } = fakeDb([]);
  assert.equal(await writeHubAgentStatus(db, 1, "Hub", { parking: null }), 0);
});
