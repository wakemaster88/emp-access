import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeVlans, parsePortList, Confirmer, type VlanTables } from "./vlan-analyze.js";

test("Port-Bitmap: erstes Bit ist Port 1, umgebrochene Hex-Strings", () => {
  assert.deepEqual([...parsePortList("Hex-STRING: 80 00")], [1]);
  assert.deepEqual([...parsePortList("C1 00 01")].sort((a, b) => a - b), [1, 2, 8, 24]);
  assert.deepEqual([...parsePortList("ff")].length, 8);
  assert.deepEqual([...parsePortList('""')], []);
});

function tables(over: Partial<VlanTables>): VlanTables {
  return {
    pvid: new Map(),
    egress: new Map(),
    untagged: new Map(),
    ...over,
  };
}

test("GC108P-Fehler: PVID 30 ohne Mitgliedschaft in VLAN 30", () => {
  const issues = analyzeVlans(
    tables({
      pvid: new Map([
        [1, 1],
        [7, 30],
      ]),
      egress: new Map([
        [1, new Set([1, 7])],
        [30, new Set([1])],
      ]),
      untagged: new Map([[1, new Set([1, 7])]]),
      up: new Map([[7, true]]),
    })
  );
  assert.deepEqual(
    issues.map((i) => [i.port, i.kind]),
    [
      [7, "pvid-nomember"],
      [7, "untagged-other"],
    ]
  );
  assert.match(issues[0].message, /Port 7: PVID 30, aber nicht Mitglied in VLAN 30 \(ist U1\)/);
  assert.equal(issues[0].up, true);
});

test("Andere Haelfte des Fehlers: U30, aber PVID noch 1", () => {
  const issues = analyzeVlans(
    tables({
      pvid: new Map([[3, 1]]),
      egress: new Map([[30, new Set([3])]]),
      untagged: new Map([[30, new Set([3])]]),
    })
  );
  assert.deepEqual(issues.map((i) => i.kind), ["pvid-nomember", "untagged-other"]);
});

test("Korrekte Konfiguration: Kamera-Port U30/PVID 30, Uplink U1 + T30/T40", () => {
  const issues = analyzeVlans(
    tables({
      pvid: new Map([
        [1, 1],
        [6, 30],
      ]),
      egress: new Map([
        [1, new Set([1])],
        [30, new Set([1, 6])],
        [40, new Set([1])],
      ]),
      untagged: new Map([
        [1, new Set([1])],
        [30, new Set([6])],
      ]),
    })
  );
  assert.deepEqual(issues, []);
});

test("Nur getaggt und doppelt ungetaggt", () => {
  const issues = analyzeVlans(
    tables({
      pvid: new Map([
        [2, 40],
        [5, 1],
      ]),
      egress: new Map([
        [1, new Set([5])],
        [40, new Set([2])],
      ]),
      untagged: new Map([
        [1, new Set([5])],
        [30, new Set([5])],
      ]),
    })
  );
  assert.deepEqual(
    issues.map((i) => [i.port, i.kind]),
    [
      [2, "pvid-tagged"],
      [5, "multi-untagged"],
    ]
  );
});

test("Confirmer: erst nach zwei Durchlaeufen, stummer Switch friert ein", () => {
  const c = new Confirmer(2);
  assert.deepEqual([...c.update(["a", "b"])], []);
  assert.deepEqual([...c.update(["a", "b"])].sort(), ["a", "b"]);
  // Switch von b antwortet nicht: b bleibt gezaehlt, taucht aber nicht auf.
  assert.deepEqual([...c.update(["a"], ["b"])], ["a"]);
  assert.deepEqual([...c.update(["a", "b"])].sort(), ["a", "b"]);
  // a ist weg: Zaehler zurueck.
  c.update(["b"]);
  assert.deepEqual([...c.update(["a", "b"])], ["b"]);
});
