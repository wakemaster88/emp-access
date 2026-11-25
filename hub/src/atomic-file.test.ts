import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { writeFileAtomic } from "./atomic-file.js";

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "atomic-file-"));
}

test("Datei wird angelegt, auch wenn der Ordner noch fehlt, und es bleibt keine zweite Datei liegen", async () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, ".cache", "liste.json");
    await writeFileAtomic(file, '{"a":1}');
    assert.equal(readFileSync(file, "utf8"), '{"a":1}');
    assert.deepEqual(readdirSync(path.dirname(file)), ["liste.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Vorhandene Datei wird ersetzt, ein liegengebliebener Rest der zweiten Datei stoert nicht", async () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "liste.json");
    writeFileSync(file, "alt");
    writeFileSync(`${file}.tmp`, "halb geschrie");
    await writeFileAtomic(file, "neu");
    assert.equal(readFileSync(file, "utf8"), "neu");
    assert.equal(existsSync(`${file}.tmp`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Scheitert das Ersetzen, bleibt der alte Stand und der Fehler kommt beim Aufrufer an", async () => {
  const dir = tmpDir();
  try {
    // Das Ziel ist ein Ordner mit Inhalt: Umbenennen darauf scheitert.
    const target = path.join(dir, "liste.json");
    mkdirSync(target);
    writeFileSync(path.join(target, "inhalt"), "alt");
    await assert.rejects(writeFileAtomic(target, "neu"));
    assert.equal(readFileSync(path.join(target, "inhalt"), "utf8"), "alt");
    assert.equal(existsSync(`${target}.tmp`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Nacheinander geschriebene Staende: der letzte gewinnt", async () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "liste.json");
    for (let i = 0; i < 20; i++) await writeFileAtomic(file, `stand ${i}`);
    assert.equal(readFileSync(file, "utf8"), "stand 19");
    assert.deepEqual(readdirSync(dir), ["liste.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
