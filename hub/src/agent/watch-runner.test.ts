import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Finding } from "./findings.js";
import { WatchRunner } from "./watch-runner.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 10, 24, 11, 0);

const cam: Finding = { key: "cam:5", severity: "warn", title: "Kamera Seilbahn A nicht erreichbar", detail: "10.0.0.5" };
const cloud: Finding = { key: "cloud", severity: "alert", title: "Cloud nicht erreichbar" };
const ram: Finding = { key: "ram", severity: "warn", title: "Arbeitsspeicher des Hubs bei 93 %" };

type Sent = { delivered: boolean; rejected: boolean };
const OK: Sent = { delivered: true, rejected: false };
const LOST: Sent = { delivered: false, rejected: false };
const REJECTED: Sent = { delivered: false, rejected: true };

/** Was ein Hub-Lauf um den Zustands-Waechter herum hat: Befunde, Uhr, Chats, Versand, Log. */
interface World {
  file: string;
  now: number;
  findings: Finding[];
  quiet: boolean;
  chats: number;
  /** Ausgang der naechsten Meldungen; ist die Liste leer, kommt jede an. */
  outcomes: Array<Sent | Promise<Sent>>;
  sent: string[];
  logs: string[];
  records: string[];
  /** `open`, wie es die letzte Pruefung an `collect` gegeben hat. */
  openSeen: string[];
}

function world(dir: string): World {
  return { file: path.join(dir, ".cache", "agent-watch.json"), now: T0, findings: [], quiet: false, chats: 1, outcomes: [], sent: [], logs: [], records: [], openSeen: [] };
}

/** Ein Hub-Lauf: neuer Waechter auf derselben Datei, wie nach einem Neustart. */
function start(w: World): WatchRunner {
  return new WatchRunner({
    file: w.file,
    collect: (_now, open) => {
      w.openSeen = [...open];
      return w.findings;
    },
    quiet: () => w.quiet,
    chats: () => w.chats,
    send: async (text) => {
      w.sent.push(text);
      return w.outcomes.shift() ?? OK;
    },
    log: (line) => w.logs.push(line),
    record: (kind, text) => w.records.push(`${kind}: ${text}`),
    now: () => w.now,
  });
}

async function withDir(run: (w: World) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "watch-runner-"));
  try {
    await run(world(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Eine Pruefung zur Zeit `at` (Minuten nach dem Beginn), danach ist die Zustellung abgeschlossen. */
async function check(r: WatchRunner, w: World, at: number, findings: Finding[]): Promise<void> {
  w.now = T0 + at * MIN;
  w.findings = findings;
  await r.tick();
  await r.close();
}

const saved = (w: World) => JSON.parse(readFileSync(w.file, "utf8")) as { savedAt: number; tracked: Array<{ finding: Finding; notified: boolean }>; deferred: Finding[] };

test("Meldung, Log-Zeile und gespeicherter Stand zu jeder Änderung", async () => {
  await withDir(async (w) => {
    const r = start(w);
    await r.load();
    assert.deepEqual(w.logs, []);
    await check(r, w, 0, [cam, cloud]);
    assert.deepEqual(w.sent, ["‼️ Cloud nicht erreichbar"]);
    assert.deepEqual(w.logs, ["Zustands-Wächter: gemeldet [cloud] Cloud nicht erreichbar"]);
    assert.equal(saved(w).savedAt, T0);
    await check(r, w, 5, [cam, cloud]);
    assert.equal(w.sent[1], "⚠️ Kamera Seilbahn A nicht erreichbar\n   10.0.0.5");
    assert.equal(w.logs[1], "Zustands-Wächter: gemeldet [cam:5] Kamera Seilbahn A nicht erreichbar");
    await check(r, w, 10, [cam]);
    assert.equal(w.sent[2], "✅ Wieder in Ordnung: Cloud nicht erreichbar (nach 10 min)");
    assert.equal(w.logs[2], "Zustands-Wächter: Entwarnung [cloud] Cloud nicht erreichbar (nach 10 min)");
    assert.deepEqual(
      saved(w).tracked.map((t) => [t.finding.key, t.notified]),
      [["cam:5", true]]
    );
    assert.equal(saved(w).savedAt, T0 + 10 * MIN);
    assert.deepEqual(r.open(), [cam]);
    // Neben dem Stand bleibt keine zweite Datei liegen.
    assert.deepEqual(readdirSync(path.dirname(w.file)), ["agent-watch.json"]);
    assert.deepEqual(w.records, []);
  });
});

test("Neustart: ein gemeldeter Befund wird nicht noch einmal gemeldet", async () => {
  await withDir(async (w) => {
    const before = start(w);
    await check(before, w, 0, [cam, cloud]);
    await check(before, w, 5, [cam, cloud]);
    assert.equal(w.sent.length, 2);
    w.sent.length = 0;
    w.logs.length = 0;

    const after = start(w);
    w.now = T0 + 7 * MIN;
    await after.load();
    assert.deepEqual(w.logs, ["Zustands-Wächter: Stand von vor 2 min übernommen: 2 Befunde gemeldet"]);
    assert.deepEqual(after.open(), [cam, cloud]);
    for (const at of [12, 17, 22]) await check(after, w, at, [cam, cloud]);
    assert.deepEqual(w.sent, []);
    assert.equal(w.logs.length, 1);
    // Die Befunde-Sammlung kennt die gemeldeten Befunde von vor dem Neustart.
    assert.deepEqual(w.openSeen, ["cam:5", "cloud"]);
  });
});

test("Neustart: was währenddessen in Ordnung kam, bekommt seine Entwarnung", async () => {
  await withDir(async (w) => {
    const before = start(w);
    await check(before, w, 0, [cam, cloud]);
    await check(before, w, 5, [cam, cloud]);
    w.sent.length = 0;

    const after = start(w);
    w.now = T0 + 7 * MIN;
    await after.load();
    await check(after, w, 12, [cam]);
    assert.deepEqual(w.sent, ["✅ Wieder in Ordnung: Cloud nicht erreichbar (nach 12 min)"]);
    assert.deepEqual(after.open(), [cam]);
  });
});

test("Neustart in der Ruhezeit: die zurückgestellte Meldung kommt am Morgen, einmal", async () => {
  await withDir(async (w) => {
    w.quiet = true;
    const before = start(w);
    await check(before, w, 0, [ram]);
    await check(before, w, 5, [ram]);
    assert.deepEqual(w.sent, []);
    assert.deepEqual(w.logs, ["Zustands-Wächter: Ruhezeit, Meldung kommt am Morgen [ram] Arbeitsspeicher des Hubs bei 93 %"]);
    assert.deepEqual(w.records, ["warn: ⚠️ Arbeitsspeicher des Hubs bei 93 % (Ruhezeit – Meldung kommt morgens)"]);
    assert.deepEqual(saved(w).deferred, [ram]);

    const after = start(w);
    w.now = T0 + 20 * MIN;
    w.logs.length = 0;
    await after.load();
    assert.deepEqual(w.logs, ["Zustands-Wächter: Stand von vor 15 min übernommen: 0 Befunde gemeldet, 1 für den Morgen zurückgestellt"]);
    await check(after, w, 25, [ram]);
    assert.deepEqual(w.sent, []);
    w.quiet = false;
    await check(after, w, 8 * 60, [ram]);
    assert.deepEqual(w.sent, ["⚠️ Arbeitsspeicher des Hubs bei 93 %"]);
    await check(after, w, 8 * 60 + 5, [ram]);
    assert.equal(w.sent.length, 1);
    assert.deepEqual(saved(w).deferred, []);
  });
});

test("Meldung hat keinen Chat erreicht: Befund und Entwarnung kommen bei der nächsten Prüfung erneut", async () => {
  await withDir(async (w) => {
    const r = start(w);
    w.outcomes = [LOST];
    await check(r, w, 0, [cloud]);
    assert.deepEqual(r.open(), []);
    assert.deepEqual(
      saved(w).tracked.map((t) => [t.finding.key, t.notified]),
      [["cloud", false]]
    );
    await check(r, w, 5, [cloud]);
    assert.deepEqual(w.sent, ["‼️ Cloud nicht erreichbar", "‼️ Cloud nicht erreichbar"]);
    assert.deepEqual(r.open(), [cloud]);
    // Die Entwarnung erreicht niemanden: Sie kommt erneut, auch nach einem Neustart.
    w.outcomes = [LOST];
    await check(r, w, 10, []);
    assert.equal(w.sent[2], "✅ Wieder in Ordnung: Cloud nicht erreichbar (nach 10 min)");
    const after = start(w);
    w.now = T0 + 12 * MIN;
    w.logs.length = 0;
    await after.load();
    assert.deepEqual(w.logs, ["Zustands-Wächter: Stand von vor 2 min übernommen: 0 Befunde gemeldet, 1 Entwarnung noch zu senden"]);
    await check(after, w, 17, []);
    assert.equal(w.sent[3], "✅ Wieder in Ordnung: Cloud nicht erreichbar (nach 10 min)");
    await check(after, w, 22, []);
    assert.equal(w.sent.length, 4);
  });
});

test("Lehnt Telegram die Meldung ab, gilt der Befund weiter als gemeldet", async () => {
  await withDir(async (w) => {
    const r = start(w);
    w.outcomes = [REJECTED];
    await check(r, w, 0, [cloud]);
    await check(r, w, 5, [cloud]);
    assert.equal(w.sent.length, 1);
    assert.deepEqual(r.open(), [cloud]);
  });
});

test("Die Prüfung wartet nicht auf die Zustellung; das Beenden wartet ihren Ausgang ab und speichert ihn", async () => {
  await withDir(async (w) => {
    const r = start(w);
    let settle: (s: Sent) => void = () => undefined;
    w.outcomes = [new Promise<Sent>((res) => (settle = res))];
    w.findings = [cloud];
    await r.tick();
    assert.deepEqual(r.open(), [cloud]);
    // Auf der Platte gilt der Befund erst nach der Zustellung als gemeldet.
    assert.equal(saved(w).tracked[0].notified, false);
    let closed = false;
    const closing = r.close().then(() => {
      closed = true;
    });
    await new Promise<void>((res) => setImmediate(res));
    assert.equal(closed, false);
    settle(LOST);
    await closing;
    assert.equal(saved(w).tracked[0].notified, false);
    // Nach dem Neustart kommt die Meldung erneut.
    const after = start(w);
    await after.load();
    await check(after, w, 6, [cloud]);
    assert.deepEqual(w.sent, ["‼️ Cloud nicht erreichbar", "‼️ Cloud nicht erreichbar"]);
  });
});

test("Endet der Hub, während eine Meldung unterwegs ist, kommen Befund und Entwarnung nach dem Neustart", async () => {
  await withDir(async (w) => {
    const r = start(w);
    // Telegram antwortet nicht: Die Zustellung bleibt offen, der Hub endet hart.
    w.outcomes = [new Promise<Sent>(() => undefined)];
    w.findings = [cloud];
    w.now = T0;
    await r.tick();
    assert.deepEqual(r.open(), [cloud]);
    const after = start(w);
    w.now = T0 + 2 * MIN;
    await after.load();
    await check(after, w, 6, [cloud]);
    assert.deepEqual(w.sent, ["‼️ Cloud nicht erreichbar", "‼️ Cloud nicht erreichbar"]);
    assert.equal(saved(w).tracked[0].notified, true);

    // Dasselbe für eine Entwarnung, die unterwegs ist.
    w.outcomes = [new Promise<Sent>(() => undefined)];
    w.now = T0 + 11 * MIN;
    w.findings = [];
    await after.tick();
    assert.equal(w.sent[2], "✅ Wieder in Ordnung: Cloud nicht erreichbar (nach 11 min)");
    const third = start(w);
    w.now = T0 + 13 * MIN;
    w.logs.length = 0;
    await third.load();
    assert.deepEqual(w.logs, ["Zustands-Wächter: Stand von vor 2 min übernommen: 0 Befunde gemeldet, 1 Entwarnung noch zu senden"]);
    await check(third, w, 16, []);
    assert.equal(w.sent[3], "✅ Wieder in Ordnung: Cloud nicht erreichbar (nach 11 min)");
  });
});

test("Ist die Meldung zugestellt, gilt der Befund auch auf der Platte als gemeldet", async () => {
  await withDir(async (w) => {
    const r = start(w);
    let settle: (s: Sent) => void = () => undefined;
    w.outcomes = [new Promise<Sent>((res) => (settle = res))];
    w.findings = [cloud];
    await r.tick();
    assert.equal(saved(w).tracked[0].notified, false);
    settle(OK);
    await r.close();
    assert.equal(saved(w).tracked[0].notified, true);
    const after = start(w);
    await after.load();
    await check(after, w, 6, [cloud]);
    assert.equal(w.sent.length, 1);
  });
});

test("Kein Chat gekoppelt: die Meldung steht im KI-Protokoll und mit Hinweis im Log", async () => {
  await withDir(async (w) => {
    w.chats = 0;
    const r = start(w);
    await check(r, w, 0, [cloud]);
    await check(r, w, 5, []);
    assert.deepEqual(w.sent, []);
    assert.deepEqual(w.records, ["alert: ‼️ Cloud nicht erreichbar", "ok: ✅ Wieder in Ordnung: Cloud nicht erreichbar (nach 5 min)"]);
    assert.deepEqual(w.logs, [
      "Zustands-Wächter: gemeldet [cloud] Cloud nicht erreichbar (kein Telegram-Chat gekoppelt, steht im KI-Protokoll)",
      "Zustands-Wächter: Entwarnung [cloud] Cloud nicht erreichbar (nach 5 min) (kein Telegram-Chat gekoppelt, steht im KI-Protokoll)",
    ]);
  });
});

test("Ein Stand, der älter als 24 Stunden ist, wird verworfen: Der Befund wird neu gemeldet", async () => {
  await withDir(async (w) => {
    const before = start(w);
    await check(before, w, 0, [cloud]);
    w.sent.length = 0;
    w.logs.length = 0;
    const after = start(w);
    w.now = T0 + 24 * HOUR + MIN;
    await after.load();
    assert.deepEqual(w.logs, ["Zustands-Wächter: gespeicherter Stand verworfen (älter als 24 Stunden), beginne ohne gemeldete Befunde"]);
    assert.deepEqual(after.open(), []);
    await check(after, w, 24 * 60 + 6, [cloud]);
    assert.deepEqual(w.sent, ["‼️ Cloud nicht erreichbar"]);
  });
});

test("Ein unlesbarer Stand wird verworfen und beim nächsten Speichern ersetzt", async () => {
  await withDir(async (w) => {
    mkdirSync(path.dirname(w.file), { recursive: true });
    writeFileSync(w.file, '{"v":1,"savedAt":17');
    const r = start(w);
    await r.load();
    assert.deepEqual(w.logs, ["Zustands-Wächter: gespeicherter Stand verworfen (nicht lesbar), beginne ohne gemeldete Befunde"]);
    assert.deepEqual(r.open(), []);
    await check(r, w, 0, [cloud]);
    assert.equal(saved(w).tracked[0].finding.key, "cloud");
  });
});

test("Ohne Befunde wird keine Datei angelegt; ohne Änderung wird nicht neu geschrieben", async () => {
  await withDir(async (w) => {
    const r = start(w);
    await r.load();
    await check(r, w, 0, []);
    await check(r, w, 5, []);
    assert.equal(existsSync(w.file), false);
    assert.deepEqual(w.logs, []);
    await check(r, w, 10, [cloud]);
    await check(r, w, 15, []);
    assert.equal(saved(w).savedAt, T0 + 15 * MIN);
    await check(r, w, 20, []);
    await check(r, w, 25, []);
    assert.equal(saved(w).savedAt, T0 + 15 * MIN);
    assert.deepEqual(saved(w).tracked, []);
  });
});

test("Lässt sich der Stand nicht speichern, steht das im Log und die Prüfung läuft weiter", async () => {
  await withDir(async (w) => {
    // Wo der Ordner liegen soll, liegt eine Datei: Schreiben scheitert.
    writeFileSync(path.dirname(w.file), "kein Ordner");
    const r = start(w);
    await r.load();
    await check(r, w, 0, [cloud]);
    assert.deepEqual(w.sent, ["‼️ Cloud nicht erreichbar"]);
    assert.equal(w.logs.filter((l) => l.startsWith("Zustands-Wächter: Stand nicht gespeichert: ")).length, 1);
    assert.equal(w.logs.filter((l) => l.startsWith("Zustands-Wächter: gespeicherter Stand nicht lesbar (")).length, 1);
    await check(r, w, 5, [cloud]);
    assert.deepEqual(r.open(), [cloud]);
    assert.equal(w.sent.length, 1);
    // Solange es scheitert, bleibt es bei der einen Zeile; gelingt es wieder, steht auch das im Log.
    assert.equal(w.logs.filter((l) => l.startsWith("Zustands-Wächter: Stand nicht gespeichert: ")).length, 1);
    rmSync(path.dirname(w.file));
    await check(r, w, 10, [cloud]);
    assert.equal(w.logs[w.logs.length - 1], "Zustands-Wächter: Stand wird wieder gespeichert");
    assert.equal(saved(w).tracked[0].finding.key, "cloud");
  });
});

test("Ist die Ruhezeit nicht bestimmbar, scheitert die Prüfung, bevor sich der Stand ändert", async () => {
  await withDir(async (w) => {
    const r = new WatchRunner({
      file: w.file,
      collect: () => [cloud],
      quiet: () => {
        throw new Error("Ortszeit nicht lesbar");
      },
      chats: () => 1,
      send: async (text) => {
        w.sent.push(text);
        return OK;
      },
      log: (line) => w.logs.push(line),
      record: () => undefined,
      now: () => T0,
    });
    await assert.rejects(r.tick(), /Ortszeit nicht lesbar/);
    assert.deepEqual(r.open(), []);
    assert.deepEqual(w.sent, []);
  });
});
