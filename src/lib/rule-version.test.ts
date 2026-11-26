import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { BOOKED_PLAN_REFRESH_MS, loadRuleVersion, ruleVersion, type RuleVersionInput } from "./rule-version";

const NOW = new Date("2026-11-26T10:00:00.000Z");

function stand(patch: Partial<RuleVersionInput> = {}): RuleVersionInput {
  return {
    accountId: 7,
    rules: 12,
    rulesAt: new Date("2026-11-20T08:00:00.000Z"),
    booked: 0,
    rooms: 5,
    roomsAt: new Date("2026-10-01T08:00:00.000Z"),
    schedules: 3,
    schedulesAt: new Date("2026-11-01T08:00:00.000Z"),
    camerasSig: "c0ffee01",
    devicesSig: "d0d0d001",
    accountSig: '["Europe/Berlin", 51.9, 8.3]',
    ...patch,
  };
}

test("Regel-Version: gleicher Stand ergibt dieselbe Version, auch Stunden spaeter", () => {
  const v = ruleVersion(stand(), NOW);
  assert.match(v, /^[0-9a-f]{16}$/);
  assert.equal(ruleVersion(stand(), new Date(NOW.getTime() + 6 * 3_600_000)), v);
});

test("Regel-Version: jede Aenderung an Regeln, Raeumen, Betriebszeiten, Kameras, Geraeten und Konto ergibt eine neue", () => {
  const v = ruleVersion(stand(), NOW);
  const later = new Date("2026-11-26T09:59:00.000Z");
  const changes: Array<[string, Partial<RuleVersionInput>]> = [
    ["Regel bearbeitet", { rulesAt: later }],
    ["Regel geloescht", { rules: 11 }],
    ["Raum bearbeitet", { roomsAt: later }],
    ["Raum geloescht", { rooms: 4 }],
    ["Betriebszeit bearbeitet", { schedulesAt: later }],
    ["Betriebszeit geloescht", { schedules: 2 }],
    ["Kamera in anderen Raum oder deaktiviert", { camerasSig: "c0ffee02" }],
    ["letzte Kamera geloescht", { camerasSig: null }],
    ["Geraet: Typ, Kategorie, IP, Aktiv oder Raum geaendert", { devicesSig: "d0d0d002" }],
    ["Zeitzone oder Standort geaendert", { accountSig: '["Europe/Berlin", 52.0, 8.3]' }],
    ["anderes Konto", { accountId: 8 }],
  ];
  const seen = new Set([v]);
  for (const [name, patch] of changes) {
    const next = ruleVersion(stand(patch), NOW);
    assert.notEqual(next, v, name);
    seen.add(next);
  }
  assert.equal(seen.size, changes.length + 1, "alle verschieden");
});

test("Regel-Version: ohne Regeln, Raeume und Betriebszeiten gibt es trotzdem eine Version", () => {
  const leer = stand({ rules: 0, rulesAt: null, rooms: 0, roomsAt: null, schedules: 0, schedulesAt: null, camerasSig: null, devicesSig: null });
  assert.match(ruleVersion(leer, NOW), /^[0-9a-f]{16}$/);
  assert.notEqual(ruleVersion(leer, NOW), ruleVersion(stand(), NOW));
});

test("Regel-Version: mit Regeln zu gebuchten Terminen wechselt sie alle 15 Minuten", () => {
  const gebucht = stand({ booked: 1 });
  const start = new Date("2026-11-26T10:00:00.000Z");
  const v = ruleVersion(gebucht, start);
  assert.equal(ruleVersion(gebucht, new Date(start.getTime() + BOOKED_PLAN_REFRESH_MS - 1)), v, "im selben Viertel");
  assert.notEqual(ruleVersion(gebucht, new Date(start.getTime() + BOOKED_PLAN_REFRESH_MS)), v, "naechstes Viertel");
});

test("Regel-Version: eine Abfrage, an das Konto gebunden", async () => {
  const calls: unknown[][] = [];
  const db = {
    $queryRaw: async (...args: unknown[]) => {
      calls.push(args);
      return [
        {
          rules: 12,
          rulesAt: new Date("2026-11-20T08:00:00.000Z"),
          booked: 0,
          rooms: 5,
          roomsAt: new Date("2026-10-01T08:00:00.000Z"),
          schedules: 3,
          schedulesAt: new Date("2026-11-01T08:00:00.000Z"),
          camerasSig: "c0ffee01",
          devicesSig: "d0d0d001",
          accountSig: '["Europe/Berlin", 51.9, 8.3]',
        },
      ];
    },
  } as unknown as PrismaClient;
  assert.equal(await loadRuleVersion(db, 7, NOW), ruleVersion(stand(), NOW));
  assert.equal(calls.length, 1);
  const values = calls[0].slice(1);
  assert.ok(values.length > 0 && values.every((x) => x === 7), "nur das eigene Konto");
  // Jede Tabelle nur mit dem Konto als Bedingung; Kameras, Geraete und Konto in derselben Abfrage.
  const sql = (calls[0][0] as string[]).join("?");
  for (const table of ["RoomRule", "KeyRoom", "OperatingSchedule", "Camera", "Device", "Account"]) {
    assert.match(sql, new RegExp(`FROM "${table}" WHERE "${table === "Account" ? "id" : "accountId"}" = \\?`), table);
  }
  assert.doesNotMatch(sql, /updatedAt"\) FROM "(Camera|Device|Account)"/, "nicht ueber updatedAt");
  for (const field of ["keyRoomId", "enabled", "type", "category", "ipAddress", "isActive", "timezone", "latitude", "longitude"]) {
    assert.match(sql, new RegExp(`"${field}"`), field);
  }
});

test("Regel-Version: ohne Fingerabdruecke aus der Abfrage (keine Kameras, keine Geraete) bleibt sie stabil", async () => {
  const db = {
    $queryRaw: async () => [{ rules: 0, rulesAt: null, booked: 0, rooms: 0, roomsAt: null, schedules: 0, schedulesAt: null, camerasSig: null, devicesSig: null, accountSig: null }],
  } as unknown as PrismaClient;
  const a = await loadRuleVersion(db, 7, NOW);
  assert.equal(await loadRuleVersion(db, 7, new Date(NOW.getTime() + 3_600_000)), a);
});
