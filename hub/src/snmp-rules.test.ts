import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HostQueue,
  SNMP_SUMMARY_EVERY_MS,
  VLAN_CHECK_OFFSET_MS,
  fdbOutcome,
  runTotals,
  snmpRunSummary,
  switchLine,
  vlanCheckRunAtMs,
  type SwitchRunEntry,
} from "./snmp-rules.js";

const tick = () => new Promise((r) => setImmediate(r));

/** Abfrage-Attrappe: zaehlt gleichzeitige Laeufe je Adresse und endet auf Zuruf. */
function fakeExec() {
  const running = new Map<string, number>();
  let maxSame = 0;
  const calls: string[] = [];
  const pending: Array<{ host: string; key: string; resolve: (v: string) => void; reject: (e: Error) => void }> = [];
  const exec = (host: string, key: string) => () =>
    new Promise<string>((resolve, reject) => {
      calls.push(`${host} ${key}`);
      running.set(host, (running.get(host) ?? 0) + 1);
      maxSame = Math.max(maxSame, ...running.values());
      const done = () => running.set(host, (running.get(host) ?? 1) - 1);
      pending.push({
        host,
        key,
        resolve: (v) => {
          done();
          resolve(v);
        },
        reject: (e) => {
          done();
          reject(e);
        },
      });
    });
  return { exec, calls, pending, maxSame: () => maxSame, running };
}

test("Warteschlange: je Switch nie zwei Abfragen gleichzeitig, verschiedene Switches nebeneinander", async () => {
  const q = new HostQueue();
  const f = fakeExec();
  const a1 = q.run("10.0.0.2", "walk A", f.exec("10.0.0.2", "walk A"));
  const a2 = q.run("10.0.0.2", "walk B", f.exec("10.0.0.2", "walk B"));
  const b1 = q.run("10.0.0.3", "walk A", f.exec("10.0.0.3", "walk A"));
  await tick();
  assert.deepEqual(f.calls, ["10.0.0.2 walk A", "10.0.0.3 walk A"]);
  f.pending.shift()!.resolve("a1");
  assert.equal(await a1, "a1");
  await tick();
  assert.deepEqual(f.calls, ["10.0.0.2 walk A", "10.0.0.3 walk A", "10.0.0.2 walk B"]);
  for (const p of f.pending.splice(0)) p.resolve(`${p.host} ${p.key}`);
  assert.equal(await a2, "10.0.0.2 walk B");
  assert.equal(await b1, "10.0.0.3 walk A");
  assert.equal(f.maxSame(), 1);
  await tick();
  assert.equal(q.busy("10.0.0.2"), false);
});

test("Warteschlange: gleiche wartende Abfrage teilt das Ergebnis, eine laufende nicht", async () => {
  const q = new HostQueue();
  const f = fakeExec();
  const first = q.run("r", "walk ARP", f.exec("r", "walk ARP"));
  await tick();
  // Laeuft schon: eine neue gleiche Abfrage wartet auf einen eigenen Lauf.
  const second = q.run("r", "walk ARP", f.exec("r", "walk ARP"));
  // Wartet schon: dieselbe Abfrage haengt sich an.
  const third = q.run("r", "walk ARP", f.exec("r", "walk ARP"));
  assert.equal(second, third);
  f.pending.shift()!.resolve("1");
  await tick();
  f.pending.shift()!.resolve("2");
  assert.equal(await first, "1");
  assert.equal(await second, "2");
  assert.equal(f.calls.length, 2);
});

test("Warteschlange: ein Fehler trifft nur den eigenen Aufrufer, die naechste Abfrage laeuft", async () => {
  const q = new HostQueue();
  const f = fakeExec();
  const bad = q.run("h", "get sysName", f.exec("h", "get sysName"));
  const good = q.run("h", "walk ifDescr", f.exec("h", "walk ifDescr"));
  await tick();
  f.pending.shift()!.reject(new Error("Timeout"));
  await assert.rejects(bad, /Timeout/);
  await tick();
  f.pending.shift()!.resolve("ok");
  assert.equal(await good, "ok");
});

test("VLAN-Pruefung: Start plus 150 s, dann alle 300 s; nie naeher als 150 s an der Switch-Abfrage (900 s)", () => {
  assert.equal(VLAN_CHECK_OFFSET_MS, 150_000);
  assert.equal(vlanCheckRunAtMs(0, 300_000), 150_000);
  assert.equal(vlanCheckRunAtMs(1, 300_000), 450_000);
  assert.equal(vlanCheckRunAtMs(2, 300_000), 750_000);
  for (let n = 0; n < 288; n++) {
    const at = vlanCheckRunAtMs(n, 300_000);
    const toSnmp = at % 900_000;
    assert.ok(Math.min(toSnmp, 900_000 - toSnmp) >= 150_000, `Lauf ${n} bei ${at}`);
  }
});

const mac = (n: number) => ({ mac: `00:11:22:33:44:${n.toString(16).padStart(2, "0").toUpperCase()}`, port: n, vlan: 1 });

test("MAC-Tabelle: leer nach gefuellt ist ein Teilausfall, die vorige bleibt mit ihrem Stand", () => {
  const prev = { macTable: [mac(1), mac(2)], macsAt: "2026-11-26T10:00:00.000Z" };
  assert.deepEqual(fdbOutcome(prev, [], "2026-11-26T10:15:00.000Z"), {
    macTable: prev.macTable,
    macsAt: "2026-11-26T10:00:00.000Z",
    partial: true,
  });
  // Wieder gefuellt: die neue Tabelle mit neuem Stand.
  assert.deepEqual(fdbOutcome(prev, [mac(3)], "2026-11-26T10:30:00.000Z"), {
    macTable: [mac(3)],
    macsAt: "2026-11-26T10:30:00.000Z",
    partial: false,
  });
});

test("MAC-Tabelle: leer ohne gefuellte davor (erster Lauf, immer leer) gilt, wie sie ist", () => {
  assert.deepEqual(fdbOutcome(null, [], "t1"), { macTable: [], macsAt: "t1", partial: false });
  assert.deepEqual(fdbOutcome({ macTable: [], macsAt: "t0" }, [], "t1"), { macTable: [], macsAt: "t1", partial: false });
});

const sw = (o: Partial<SwitchRunEntry> = {}): SwitchRunEntry => ({
  host: "10.0.0.2",
  name: "sw-test",
  error: null,
  ports: 16,
  portsUp: 9,
  macs: 40,
  partial: false,
  ...o,
});

const H = SNMP_SUMMARY_EVERY_MS;

test("Lauf-Zeilen: erster Lauf je Switch eine Zeile, danach ohne Aenderung nichts", () => {
  const first = snmpRunSummary(null, { at: 1_000, switches: [sw(), sw({ host: "10.0.0.3", name: null, error: "keine SNMP-Antwort" })] });
  assert.deepEqual(first.lines, [
    "10.0.0.2 sw-test – 16 Ports, 9 mit Link, 40 MACs",
    "10.0.0.3: keine SNMP-Antwort",
  ]);
  // Die MAC-Zahl wandert, das ist keine Aenderung.
  const again = snmpRunSummary(first.state, {
    at: 1_000 + 900_000,
    switches: [sw({ macs: 37 }), sw({ host: "10.0.0.3", name: null, error: "keine SNMP-Antwort" })],
  });
  assert.deepEqual(again.lines, []);
  assert.equal(again.state.lastLineAt, 1_000);
});

test("Lauf-Zeilen: Switch weg und wieder da, anderer Fehlertext", () => {
  const s0 = snmpRunSummary(null, { at: 0, switches: [sw()] }).state;
  const gone = snmpRunSummary(s0, { at: 900_000, switches: [sw({ error: "keine SNMP-Antwort" })] });
  assert.deepEqual(gone.lines, ["10.0.0.2 sw-test: keine SNMP-Antwort"]);
  // Der Name bleibt aus dem vorigen Lauf, auch wenn der Fehlerfall keinen kennt.
  const goneNoName = snmpRunSummary(s0, { at: 900_000, switches: [sw({ name: null, error: "keine SNMP-Antwort" })] });
  assert.deepEqual(goneNoName.lines, ["10.0.0.2 sw-test: keine SNMP-Antwort"]);
  const still = snmpRunSummary(gone.state, { at: 1_800_000, switches: [sw({ error: "keine SNMP-Antwort" })] });
  assert.deepEqual(still.lines, []);
  const other = snmpRunSummary(still.state, { at: 2_700_000, switches: [sw({ error: "Switch-Adresse unbekannt" })] });
  assert.deepEqual(other.lines, ["10.0.0.2 sw-test: Switch-Adresse unbekannt"]);
  const back = snmpRunSummary(other.state, { at: 3_600_000, switches: [sw()] });
  assert.deepEqual(back.lines, ["10.0.0.2 sw-test wieder erreichbar – 16 Ports, 9 mit Link, 40 MACs"]);
});

test("Lauf-Zeilen: Ports mit Link, Port-Zahl und Name", () => {
  const s0 = snmpRunSummary(null, { at: 0, switches: [sw()] }).state;
  assert.deepEqual(snmpRunSummary(s0, { at: 1, switches: [sw({ portsUp: 8 })] }).lines, ["10.0.0.2 sw-test – Ports mit Link 9 → 8"]);
  assert.deepEqual(snmpRunSummary(s0, { at: 1, switches: [sw({ ports: 24, portsUp: 10 })] }).lines, [
    "10.0.0.2 sw-test – Ports 16 → 24, Ports mit Link 9 → 10",
  ]);
  assert.deepEqual(snmpRunSummary(s0, { at: 1, switches: [sw({ name: "sw-neu" })] }).lines, ["10.0.0.2 sw-neu – Name sw-test → sw-neu"]);
});

test("Lauf-Zeilen: Teilausfall der MAC-Tabelle und sein Ende, leere und gefuellte Tabelle", () => {
  const s0 = snmpRunSummary(null, { at: 0, switches: [sw()] }).state;
  const partial = snmpRunSummary(s0, { at: 1, switches: [sw({ partial: true })] });
  assert.deepEqual(partial.lines, ["10.0.0.2 sw-test – MAC-Tabelle leer, die vorige (40 MACs) bleibt stehen"]);
  assert.deepEqual(snmpRunSummary(partial.state, { at: 2, switches: [sw({ partial: true })] }).lines, []);
  assert.deepEqual(snmpRunSummary(partial.state, { at: 3, switches: [sw({ macs: 38 })] }).lines, [
    "10.0.0.2 sw-test – MAC-Tabelle wieder gelesen (38 MACs)",
  ]);
  const empty = snmpRunSummary(null, { at: 0, switches: [sw({ macs: 0 })] }).state;
  assert.deepEqual(snmpRunSummary(empty, { at: 1, switches: [sw({ macs: 5 })] }).lines, ["10.0.0.2 sw-test – MAC-Tabelle gefüllt (5 MACs)"]);
  assert.equal(switchLine(sw({ partial: true })), "10.0.0.2 sw-test – 16 Ports, 9 mit Link, MAC-Tabelle leer, die vorige (40 MACs) bleibt stehen");
});

test("Lauf-Zeilen: ohne Aenderung einmal je Stunde eine Sammelzeile, gezaehlt ab der letzten Zeile", () => {
  const two = [sw(), sw({ host: "10.0.0.3", name: "sw-tor", portsUp: 3, macs: 7 })];
  let state = snmpRunSummary(null, { at: 0, switches: two }).state;
  const seen: string[][] = [];
  for (let t = 900_000; t <= 2 * H; t += 900_000) {
    const r = snmpRunSummary(state, { at: t, switches: two });
    seen.push(r.lines);
    state = r.state;
  }
  // 15, 30, 45 min: nichts; 60 min: Sammelzeile; 75 … 105 min: nichts; 120 min: Sammelzeile.
  assert.deepEqual(seen.map((l) => l.length), [0, 0, 0, 1, 0, 0, 0, 1]);
  assert.equal(seen[3][0], "2/2 Switches ok, 12 Ports mit Link, 47 MACs");
  // Eine Aenderung setzt die Stunde neu.
  const changed = snmpRunSummary(state, { at: 2 * H + 900_000, switches: [sw({ portsUp: 10 }), two[1]] });
  assert.equal(changed.lines.length, 1);
  assert.equal(changed.state.lastLineAt, 2 * H + 900_000);
  assert.deepEqual(snmpRunSummary(changed.state, { at: 3 * H, switches: [sw({ portsUp: 10 }), two[1]] }).lines, []);
});

test("Sammelzeile nennt Switches ohne Antwort und mit voriger MAC-Tabelle", () => {
  assert.equal(
    runTotals([sw(), sw({ host: "10.0.0.3", error: "keine SNMP-Antwort" }), sw({ host: "10.0.0.4", partial: true, portsUp: 1, macs: 2 })]),
    "2/3 Switches ok, 10 Ports mit Link, 42 MACs; ohne Antwort: 10.0.0.3; vorige MAC-Tabelle: 10.0.0.4"
  );
});
