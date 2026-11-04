import { test } from "node:test";
import assert from "node:assert/strict";
import { diffAlerts, sanitizeReportedAlerts } from "./hub-alerts";

test("neue Befunde werden geoeffnet, verschwundene erledigt", () => {
  const stored = [
    { key: "a", resolvedAt: null },
    { key: "b", resolvedAt: null },
    { key: "c", resolvedAt: new Date() },
  ];
  const reported = [
    { key: "b", title: "B" },
    { key: "c", title: "C wieder da" },
    { key: "d", title: "D" },
  ];
  const d = diffAlerts(stored, reported);
  assert.deepEqual(d.opened.map((r) => r.key), ["c", "d"]);
  assert.deepEqual(d.still.map((r) => r.key), ["b"]);
  assert.deepEqual(d.resolved, ["a"]);
});

test("Eingabe vom Hub wird geprueft", () => {
  const out = sanitizeReportedAlerts([
    { key: "vlan:192.168.1.20:7:pvid-nomember", title: "x", severity: "alert" },
    { key: "vlan:192.168.1.20:7:pvid-nomember", title: "doppelt" },
    { key: "bad key with spaces", title: "y" },
    { key: "ok", title: "" },
    null,
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "doppelt");
  assert.equal(out[0].severity, "warn");
});
