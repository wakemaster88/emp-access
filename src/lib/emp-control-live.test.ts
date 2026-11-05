import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLive, parseMonitorUrl } from "./emp-control-live";

test("Monitor-Link wird in Herkunft und Token zerlegt", () => {
  assert.deepEqual(parseMonitorUrl("https://tuttenbrocksee.emp-control.de/monitor?token=abc123"), {
    origin: "https://tuttenbrocksee.emp-control.de",
    token: "abc123",
  });
  assert.equal(parseMonitorUrl("https://x.de/monitor"), null);
  assert.equal(parseMonitorUrl("kein link"), null);
  assert.equal(parseMonitorUrl("ftp://x.de/?token=a"), null);
  assert.equal(parseMonitorUrl(undefined), null);
});

test("Live-Antwort von emp-control wird schlank und sortiert", () => {
  const snap = normalizeLive(
    {
      workingEmployees: [
        { id: "u2", name: "Zoe Z", department: "Gastro", startTimestamp: 1793865600, onBreak: true, plannedDepartment: null, plannedEndTimestamp: null, startDiffMin: null },
        { id: "u1", name: "Anna A", department: "-", startTimestamp: 1793862000, onBreak: false, plannedDepartment: "Kasse", plannedEndTimestamp: 1793894400, startDiffMin: 7 },
      ],
      scheduledShifts: [
        { department: "Shop", startTimestamp: 1793869200, endTime: "18:00", assignedEmployees: [{ name: "Ben B" }], totalAssigned: 2, clockedIn: 1 },
      ],
    },
    new Date("2026-11-05T12:00:00Z"),
  );
  assert.equal(snap.fetchedAt, "2026-11-05T12:00:00.000Z");
  assert.deepEqual(snap.working.map((w) => w.name), ["Anna A", "Zoe Z"]);
  assert.equal(snap.working[0].department, null);
  assert.equal(snap.working[0].since, new Date(1793862000 * 1000).toISOString());
  assert.equal(snap.working[0].startDiffMin, 7);
  assert.equal(snap.working[1].onBreak, true);
  assert.deepEqual(snap.shifts[0].pending, ["Ben B"]);
  assert.equal(snap.shifts[0].end, "18:00");
});

test("Kaputte Antwort ergibt leeren Stand statt Absturz", () => {
  const snap = normalizeLive(null);
  assert.deepEqual(snap.working, []);
  assert.deepEqual(snap.shifts, []);
});
