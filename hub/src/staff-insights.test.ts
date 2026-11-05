import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStaffInsights, nameMatches } from "./staff-insights-rules.js";
import type { StaffMember } from "./staff-parse.js";

const NOW = Date.parse("2026-11-05T15:00:00Z");
const member = (id: string, name: string, extra: Partial<StaffMember> = {}): StaffMember => ({
  id,
  name,
  department: "Wake",
  since: "2026-11-05T07:59:00Z",
  onBreak: false,
  plannedDepartment: null,
  plannedEnd: "2026-11-05T17:00:00Z",
  startDiffMin: -61,
  ...extra,
});

test("Namen passen auch in Kurzform", () => {
  assert.ok(nameMatches("Jakob Schulz", "Jakob Schulz"));
  assert.ok(nameMatches("Jakob Schulz", "jakob"));
  assert.ok(nameMatches("Jakob Schulz", "Jakob S."));
  assert.ok(nameMatches("Zarlykbek Talantbek uulu", "Zarlykbek"));
  assert.ok(!nameMatches("Jakob Schulz", "Schulz"));
  assert.ok(!nameMatches("Jakob Schulz", "Anna Schulz"));
});

test("Sichtungen werden eindeutig zugeordnet, Rest wird Beobachtung", () => {
  const working = [member("1", "Jakob Schulz"), member("2", "Zarlykbek Talantbek uulu", { onBreak: true })];
  const r = buildStaffInsights(
    working,
    [{ department: "Shop", start: null, end: "18:00", pending: ["Ben B"], totalAssigned: 1, clockedIn: 0 }],
    [
      { at: NOW - 60_000, camera: "Übungslift", origin: "face", title: "Person erkannt: Jakob Schulz", list: "WHITELIST" },
      { at: NOW - 120_000, camera: "Halle", origin: "sentinel", title: "Assistent: vermutlich Mitarbeiter", detail: "Eingestempelt: Jakob Schulz, Zarlykbek Talantbek uulu" },
      { at: NOW - 180_000, camera: "Gastro", origin: "cleared", title: "Zarlykbek", kleidung: "rote Jacke" },
      { at: NOW - 240_000, camera: "Eingang", origin: "sentinel", title: "Assistent: auffällig", detail: "Person am Tor" },
      // gestern: faellt weg
      { at: NOW - 86_400_000, camera: "Halle", origin: "face", title: "Person erkannt: Jakob Schulz", list: "WHITELIST" },
    ],
    NOW,
  );
  const jakob = r.people.find((p) => p.id === "1")!;
  assert.equal(jakob.sightings.length, 1);
  assert.equal(jakob.lastSeen?.camera, "Übungslift");
  const z = r.people.find((p) => p.id === "2")!;
  assert.equal(z.lastSeen?.text, "rote Jacke");
  assert.deepEqual(z.flags.map((f) => f.text), ["Pause", "61 min vor Schichtbeginn gestempelt"]);
  assert.deepEqual(r.observations.map((o) => o.kind), ["staff", "alert"]);
  assert.deepEqual(r.pending[0].names, ["Ben B"]);
});

test("Waechter-Urteil mit genau einer eingestempelten Person gehoert ihr", () => {
  const r = buildStaffInsights(
    [member("1", "Jakob Schulz")],
    [],
    [{ at: NOW - 60_000, camera: "Halle", origin: "sentinel", title: "Assistent: vermutlich Mitarbeiter", detail: "Eingestempelt: Jakob Schulz" }],
    NOW,
  );
  assert.equal(r.people[0].sightings[0].how, "vom Wächter als Mitarbeiter eingestuft");
  assert.equal(r.observations.length, 0);
});

test("Hinweise: Verspaetung, Schichtende, ohne Schicht", () => {
  const r = buildStaffInsights(
    [
      member("1", "A", { startDiffMin: 12, plannedEnd: "2026-11-05T14:00:00Z" }),
      member("2", "B", { plannedEnd: null, startDiffMin: null }),
    ],
    [],
    [],
    NOW,
  );
  assert.deepEqual(r.people[0].flags.map((f) => f.text), ["12 min nach Schichtbeginn gestempelt", "Schichtende 15:00 überschritten"]);
  assert.deepEqual(r.people[1].flags.map((f) => f.text), ["ohne geplante Schicht"]);
});
