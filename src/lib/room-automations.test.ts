import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoomAutomation, nextAutomationRun, sortAutomations, whenLabel, type AutomationInput } from "./room-automations";
import type { ScheduleSpec } from "./operating-hours";

const TZ = "Europe/Berlin";

// Sa+So 12–16 im November, wie "Wasserski & Shop".
const weekend: ScheduleSpec = {
  name: "Wasserski",
  seasons: [
    {
      name: "November",
      startMmDd: "11-01",
      endMmDd: "11-30",
      sortOrder: 0,
      periods: [5, 6].map((weekday) => ({ weekday, opensAt: "12:00", closesAt: "16:00" })),
    },
  ],
  exceptions: [],
};

function input(over: Partial<AutomationInput>): AutomationInput {
  return {
    key: "r1",
    kind: "rule",
    name: "Test",
    isActive: true,
    trigger: "OPENING",
    offsetMinutes: 0,
    timeOfDay: null,
    daysOfWeek: 127,
    schedule: weekend,
    actions: [],
    lastRunAt: null,
    ...over,
  };
}

test("whenLabel beschreibt Versatz zur Betriebszeit", () => {
  assert.equal(whenLabel("OPENING", -30, null, 127), "30 Min. vor Öffnung");
  assert.equal(whenLabel("CLOSING", 30, null, 127), "30 Min. nach Betriebsende");
  assert.equal(whenLabel("OPENING", 0, null, 127), "zur Öffnung");
  assert.equal(whenLabel("CLOSING", 0, null, 96), "zum Betriebsende · Sa+So");
  assert.equal(whenLabel("TIME", 0, "19:00", 127), "täglich 19:00 Uhr");
  assert.equal(whenLabel("OPENING", -90, null, 127), "1:30 Std. vor Öffnung");
});

test("nächster Lauf: 30 Min. vor Öffnung am Samstag", () => {
  // Mi 04.11.2026 13:00 MEZ
  const now = new Date("2026-11-04T12:00:00Z");
  const at = nextAutomationRun(input({ offsetMinutes: -30 }), now, TZ);
  assert.equal(at?.toISOString(), "2026-11-07T10:30:00.000Z");
});

test("nächster Lauf: 30 Min. nach Schluss, auch während des Betriebs", () => {
  // Sa 07.11. 14:00 MEZ – Schluss 16:00, +30 = 16:30 MEZ
  const now = new Date("2026-11-07T13:00:00Z");
  const at = nextAutomationRun(input({ trigger: "CLOSING", offsetMinutes: 30 }), now, TZ);
  assert.equal(at?.toISOString(), "2026-11-07T15:30:00.000Z");
});

test("nächster Lauf: Uhrzeit, pausiert und ohne Betriebszeit", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  assert.equal(
    nextAutomationRun(input({ trigger: "TIME", timeOfDay: "19:00" }), now, TZ)?.toISOString(),
    "2026-11-04T18:00:00.000Z",
  );
  assert.equal(nextAutomationRun(input({ isActive: false }), now, TZ), null);
  assert.equal(nextAutomationRun(input({ schedule: null }), now, TZ), null);
  assert.equal(nextAutomationRun(input({ trigger: "MOTION" }), now, TZ), null);
});

test("Sortierung: Termine zuerst, dann Ereignisse, dann pausiert", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  const list = [
    input({ key: "p", name: "Pausiert", isActive: false }),
    input({ key: "m", name: "Bewegung", trigger: "MOTION" }),
    input({ key: "c", name: "Zu", trigger: "CLOSING", offsetMinutes: 30 }),
    input({ key: "o", name: "Auf", offsetMinutes: -30 }),
  ].map((i) => buildRoomAutomation(i, now, TZ));
  assert.deepEqual(sortAutomations(list).map((a) => a.key), ["o", "c", "m", "p"]);
});
