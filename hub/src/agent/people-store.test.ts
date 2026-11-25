import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CLEAR_MS, REPORTED_MS, type ClearedPerson, type PeopleStore } from "./people-rules.js";
import { readPeopleFile, writePeopleFile } from "./people-store.js";

const NOW = Date.UTC(2026, 0, 15, 12, 0);
const MIN = 60_000;

async function inTmp(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "people-store-"));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Fehlende Datei: leere Liste, kein Fehler", async () => {
  await inTmp(async (dir) => {
    assert.deepEqual(await readPeopleFile(path.join(dir, ".cache", "agent-people.json"), NOW), {
      store: { cleared: [], pending: [] },
      problem: null,
    });
  });
});

test("Schreiben und Lesen: derselbe Stand, keine zweite Datei bleibt liegen", async () => {
  await inTmp(async (dir) => {
    const file = path.join(dir, ".cache", "agent-people.json");
    const store: PeopleStore = {
      cleared: [
        { id: "a1", kind: "gemeldet", label: "bereits gemeldet", kleidung: "Person 1: rote Jacke", camera: "Kamera Shop", at: NOW - 5 * MIN, until: NOW + 15 * MIN },
        { id: "a2", kind: "mitarbeiter", label: "Mitarbeiter", kleidung: "Person 1: Warnweste", camera: "Kamera Shop", at: NOW - MIN, until: NOW - MIN + CLEAR_MS },
      ],
      pending: [["tok1", { camera: "Kamera Shop", kleidung: ["Person 1: rote Jacke"], at: NOW - 5 * MIN }]],
    };
    await writePeopleFile(file, store);
    assert.deepEqual(readdirSync(path.dirname(file)), ["agent-people.json"]);
    assert.deepEqual(await readPeopleFile(file, NOW), { store, problem: null });
    // Ersetzen: Der neue Stand steht vollstaendig da.
    await writePeopleFile(file, { cleared: [], pending: [] });
    assert.deepEqual(await readPeopleFile(file, NOW), { store: { cleared: [], pending: [] }, problem: null });
    assert.equal(existsSync(`${file}.tmp`), false);
  });
});

test("Datei ohne das Feld kind: Eintraege werden zugeordnet, gemeldete enden nach 20 Minuten", async () => {
  await inTmp(async (dir) => {
    const file = path.join(dir, "agent-people.json");
    writeFileSync(
      file,
      JSON.stringify({
        cleared: [
          { id: "a1", label: "bereits gemeldet", kleidung: "Person 1: rote Jacke", camera: "Kamera Shop", at: NOW - 5 * MIN, until: NOW - 5 * MIN + CLEAR_MS },
          { id: "a2", label: "Mitarbeiter", kleidung: "Person 1: Warnweste", camera: "Kamera Shop", at: NOW - MIN, until: NOW - MIN + CLEAR_MS },
          { id: "a3", label: "unbedenklich", kleidung: "Person 1: grüne Jacke", camera: "Kamera Shop", at: NOW - MIN, until: NOW - MIN + CLEAR_MS },
        ],
        pending: [],
      }),
    );
    const { store, problem } = await readPeopleFile(file, NOW);
    assert.equal(problem, null);
    assert.deepEqual(
      store.cleared.map((c) => [c.id, c.kind, c.until]),
      [
        ["a1", "gemeldet", NOW - 5 * MIN + REPORTED_MS],
        ["a2", "mitarbeiter", NOW - MIN + CLEAR_MS],
        ["a3", "freigegeben", NOW - MIN + CLEAR_MS],
      ],
    );
  });
});

test("Unlesbarer Inhalt: leere Liste und ein Grund fuer das Log", async () => {
  await inTmp(async (dir) => {
    const file = path.join(dir, "agent-people.json");
    for (const content of ['{"cleared": [{"id": "a1", "label": "Mitar', "", "[]", '"text"', "null"]) {
      writeFileSync(file, content);
      const { store, problem } = await readPeopleFile(file, NOW);
      assert.deepEqual(store, { cleared: [], pending: [] }, content);
      assert.match(problem ?? "", /^Inhalt nicht lesbar \(.+\), beginne mit leerer Liste$/, content);
    }
    // Der Inhalt selbst steht nicht im Grund.
    writeFileSync(file, '{"cleared": [{"kleidung": "Person 1: rote Ja');
    assert.doesNotMatch((await readPeopleFile(file, NOW)).problem ?? "", /rote/);
  });
});

test("Datei nicht lesbar: leere Liste und ein Grund fuer das Log", async () => {
  await inTmp(async (dir) => {
    // Ein Ordner an der Stelle der Datei laesst sich nicht lesen.
    const file = path.join(dir, "agent-people.json");
    mkdirSync(file);
    const { store, problem } = await readPeopleFile(file, NOW);
    assert.deepEqual(store, { cleared: [], pending: [] });
    assert.match(problem ?? "", /^Datei nicht lesbar \(.+\), beginne mit leerer Liste$/);
  });
});

test("Einzelne unlesbare Eintraege werden uebersprungen und gezaehlt", async () => {
  await inTmp(async (dir) => {
    const file = path.join(dir, "agent-people.json");
    const good: ClearedPerson = { id: "a1", kind: "freigegeben", label: "freigegeben", kleidung: "Person 1: rote Jacke", camera: "Kamera Shop", at: NOW - MIN, until: NOW + MIN };
    writeFileSync(file, JSON.stringify({ cleared: [good, { id: "a2" }], pending: [] }));
    assert.deepEqual(await readPeopleFile(file, NOW), { store: { cleared: [good], pending: [] }, problem: "1 Eintrag nicht lesbar, übersprungen" });
    writeFileSync(file, JSON.stringify({ cleared: [good, { id: "a2" }, 7], pending: [["tok", null]] }));
    assert.equal((await readPeopleFile(file, NOW)).problem, "3 Einträge nicht lesbar, übersprungen");
    // Der gespeicherte Stand ist gut lesbares JSON (zwei Leerzeichen Einzug).
    await writePeopleFile(file, { cleared: [good], pending: [] });
    assert.equal(readFileSync(file, "utf8"), JSON.stringify({ cleared: [good], pending: [] }, null, 2));
  });
});
