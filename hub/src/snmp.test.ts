/**
 * Auswertung der snmpwalk-Ausgabe (snmp.ts), ohne Switch: Die Zeilen sind so
 * aufgebaut, wie net-snmp sie mit `-On -Oe` schreibt. Adressen und MACs sind
 * erfunden.
 *
 * snmp.ts liest beim Laden die Hub-Einstellungen (config.ts); der Test setzt
 * die zwei Pflichtwerte vorher und laedt das Modul danach.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";

type Snmp = typeof import("./snmp.js");
let snmp: Snmp;

before(async () => {
  process.env.HUB_API_URL ??= "http://127.0.0.1:9";
  process.env.HUB_API_TOKEN ??= "test";
  process.env.HUB_IMPROVE_LOG = "0";
  snmp = await import("./snmp.js");
});

test("Walk: eine Zeile je OID, fuehrender Punkt weg, Typ-Praefix in Grossbuchstaben und Anfuehrungszeichen weg", () => {
  const out = [
    '.1.3.6.1.2.1.1.5.0 = STRING: "switch-test"',
    ".1.3.6.1.2.1.2.2.1.8.3 = INTEGER: 1",
    "1.3.6.1.2.1.2.2.1.2.4 = STRING: Port 4",
    "",
  ].join("\n");
  assert.deepEqual(snmp.parseWalk(out), [
    { oid: "1.3.6.1.2.1.1.5.0", value: "switch-test" },
    { oid: "1.3.6.1.2.1.2.2.1.8.3", value: "1" },
    { oid: "1.3.6.1.2.1.2.2.1.2.4", value: "Port 4" },
  ]);
});

test("Walk: Timeticks behalten ihr Praefix, die Zahl in Klammern bleibt lesbar", () => {
  const [row] = snmp.parseWalk(".1.3.6.1.2.1.1.3.0 = Timeticks: (12345678) 1 day, 10:17:36.78\n");
  assert.equal(row.oid, "1.3.6.1.2.1.1.3.0");
  assert.equal(row.value, "Timeticks: (12345678) 1 day, 10:17:36.78");
  // So liest pollSwitch die Laufzeit und ifLastChange.
  assert.equal(Number(row.value.match(/\((\d+)\)/)?.[1]), 12345678);
});

test("Walk: Typ-Praefixe mit Kleinbuchstaben bleiben im Wert stehen", () => {
  const rows = snmp.parseWalk(
    [
      ".1.3.6.1.2.1.17.7.1.4.5.1.1.7 = Gauge32: 30",
      ".1.3.6.1.2.1.2.2.1.14.7 = Counter32: 12",
      ".1.3.6.1.2.1.4.22.1.2.5.192.0.2.10 = Hex-STRING: 02 00 5E 10 00 01 ",
    ].join("\n"),
  );
  assert.deepEqual(
    rows.map((r) => r.value),
    ["Gauge32: 30", "Counter32: 12", "Hex-STRING: 02 00 5E 10 00 01"],
  );
});

test("Walk: umbrochene Hex-Zeilen (Port-Bitmaps) haengen an der Zeile davor", () => {
  const out = [
    ".1.3.6.1.2.1.17.7.1.4.3.1.2.30 = Hex-STRING: FF 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 ",
    "80 01 ",
    ".1.3.6.1.2.1.17.7.1.4.3.1.2.40 = Hex-STRING: 00 ",
    "",
  ].join("\n");
  const rows = snmp.parseWalk(out);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].oid, "1.3.6.1.2.1.17.7.1.4.3.1.2.30");
  assert.equal(
    rows[0].value,
    "Hex-STRING: FF 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 80 01",
  );
  assert.deepEqual(rows[1], { oid: "1.3.6.1.2.1.17.7.1.4.3.1.2.40", value: "Hex-STRING: 00" });
});

test("Walk: Text vor der ersten OID und leere Ausgabe ergeben keine Zeilen", () => {
  assert.deepEqual(snmp.parseWalk(""), []);
  assert.deepEqual(snmp.parseWalk("Timeout: No Response from 192.0.2.20\n"), []);
});

test("OID-Suffix: nur unterhalb des Praefixes, mit oder ohne fuehrenden Punkt", () => {
  assert.equal(snmp.oidSuffix("1.3.6.1.2.1.2.2.1.8.12", "1.3.6.1.2.1.2.2.1.8"), "12");
  assert.equal(snmp.oidSuffix("1.3.6.1.2.1.2.2.1.8.12", ".1.3.6.1.2.1.2.2.1.8"), "12");
  // 1.3.6.1.2.1.2.2.1.80 beginnt mit denselben Ziffern, liegt aber nicht darunter.
  assert.equal(snmp.oidSuffix("1.3.6.1.2.1.2.2.1.80.1", "1.3.6.1.2.1.2.2.1.8"), "");
  assert.equal(snmp.oidSuffix("1.3.6.1.2.1.2.2.1.8", "1.3.6.1.2.1.2.2.1.8"), "");
});

test("MAC-Tabelle: Suffix mit VLAN (Q-BRIDGE) und ohne VLAN (BRIDGE-MIB)", () => {
  // VLAN 30, MAC 02:00:5E:10:00:01 als Dezimal-Oktette.
  assert.deepEqual(snmp.vlanAndMacFromOid("30.2.0.94.16.0.1"), { vlan: 30, mac: "02:00:5E:10:00:01" });
  assert.deepEqual(snmp.vlanAndMacFromOid("2.0.94.16.0.255"), { vlan: null, mac: "02:00:5E:10:00:FF" });
  // Aus einer Walk-Zeile, wie pollSwitch sie liest.
  const [row] = snmp.parseWalk(".1.3.6.1.2.1.17.7.1.2.2.1.2.1.2.0.94.16.0.2 = INTEGER: 7\n");
  const suffix = snmp.oidSuffix(row.oid, "1.3.6.1.2.1.17.7.1.2.2.1.2");
  assert.deepEqual(snmp.vlanAndMacFromOid(suffix), { vlan: 1, mac: "02:00:5E:10:00:02" });
  assert.equal(Number(row.value), 7);
});

test("MAC-Tabelle: zu kurze oder ungueltige Suffixe ergeben keine MAC", () => {
  assert.deepEqual(snmp.vlanAndMacFromOid("2.0.94.16.0"), { vlan: null, mac: null });
  assert.deepEqual(snmp.vlanAndMacFromOid(""), { vlan: null, mac: null });
  assert.deepEqual(snmp.vlanAndMacFromOid("30.2.0.94.16.0.256"), { vlan: 30, mac: null });
  assert.deepEqual(snmp.vlanAndMacFromOid("2.0.94.x.0.1"), { vlan: null, mac: null });
});

test("Fehlertext: die Community steht nie darin, bekannte Fehler bekommen einen verstaendlichen Text", () => {
  const raw = (tail: string) =>
    new Error(`Command failed: snmpwalk -v2c -c geheim-im-test -On -Oe 192.0.2.20 1.3.6.1.2.1.2.2.1.2\n${tail}`);
  const texts = [
    snmp.friendlySnmpError(raw("Timeout: No Response from 192.0.2.20")),
    snmp.friendlySnmpError(raw("snmpwalk: Unknown host (switch-test.invalid)")),
    snmp.friendlySnmpError(raw("authorizationError")),
    snmp.friendlySnmpError(raw("irgendein anderer Fehler")),
    snmp.friendlySnmpError("Command failed: snmpget -v2c -c geheim-im-test 192.0.2.20"),
  ];
  for (const text of texts) assert.doesNotMatch(text, /geheim-im-test/);
  assert.match(texts[0], /^keine SNMP-Antwort/);
  assert.equal(texts[1], "Switch-Adresse unbekannt");
  assert.match(texts[2], /^SNMP-Zugriff verweigert/);
  // Unbekannte Fehler: erste Zeile, Community ersetzt.
  assert.equal(texts[3], "Command failed: snmpwalk -v2c -c *** -On -Oe 192.0.2.20 1.3.6.1.2.1.2.2.1.2");
  assert.equal(texts[4], "Command failed: snmpget -v2c -c *** 192.0.2.20");
});

test("Fehlertext: fehlendes Programm und abgebrochener Aufruf", () => {
  const missing = Object.assign(new Error("spawn snmpwalk ENOENT"), { code: "ENOENT" });
  assert.equal(snmp.friendlySnmpError(missing), "snmpwalk fehlt auf dem Hub – brew install net-snmp");
  assert.match(snmp.friendlySnmpError(new Error("Command failed: snmpwalk … killed SIGTERM")), /^keine SNMP-Antwort/);
  // Lange Texte werden gekuerzt.
  assert.equal(snmp.friendlySnmpError(new Error("x".repeat(500))).length, 200);
});

test("Ziele und Community kommen aus der Umgebung", () => {
  const saved = { targets: process.env.HUB_SNMP_TARGETS, community: process.env.HUB_SNMP_COMMUNITY };
  try {
    process.env.HUB_SNMP_TARGETS = " 192.0.2.20, ,198.51.100.25 ,";
    delete process.env.HUB_SNMP_COMMUNITY;
    assert.deepEqual(snmp.snmpTargets(), ["192.0.2.20", "198.51.100.25"]);
    assert.equal(snmp.snmpConfigured(), true);
    assert.equal(snmp.community(), "public");
    process.env.HUB_SNMP_TARGETS = "";
    assert.equal(snmp.snmpConfigured(), false);
  } finally {
    for (const [key, value] of [
      ["HUB_SNMP_TARGETS", saved.targets],
      ["HUB_SNMP_COMMUNITY", saved.community],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
