import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { mock, test } from "node:test";
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

const modeOf = (file: string) => statSync(file).mode & 0o777;

test("Mit Rechten: Die fertige Datei ist nur fuer den Besitzer lesbar, auch ohne Maske des Prozesses", async () => {
  const dir = tmpDir();
  // Die Rechte beim Anlegen der zweiten Datei prueft der Test danach.
  const before = process.umask(0);
  try {
    const file = path.join(dir, ".cache", "liste.json");
    await writeFileAtomic(file, "neu", { mode: 0o600 });
    assert.equal(modeOf(file), 0o600);
    assert.equal(readFileSync(file, "utf8"), "neu");
    assert.deepEqual(readdirSync(path.dirname(file)), ["liste.json"]);
  } finally {
    process.umask(before);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Mit Rechten: Die zweite Datei entsteht neu und schon mit den Rechten, bevor etwas hineingeschrieben wird", async () => {
  const dir = tmpDir();
  // Ohne Maske des Prozesses haette eine mit "w" angelegte Datei bis zum chmod 0666.
  const before = process.umask(0);
  const realOpen = fsPromises.open;
  const opened: Array<{ file: string; flags: unknown; mode: unknown; modeAtOpen: number; size: number }> = [];
  mock.method(fsPromises, "open", async (...args: Parameters<typeof fsPromises.open>) => {
    const handle = await realOpen(...args);
    const st = statSync(args[0] as string);
    opened.push({ file: String(args[0]), flags: args[1], mode: args[2], modeAtOpen: st.mode & 0o777, size: st.size });
    return handle;
  });
  // Gilt auch fuer `import { open } from "node:fs/promises"` in atomic-file.ts.
  syncBuiltinESMExports();
  try {
    const file = path.join(dir, "kopie.json");
    await writeFileAtomic(file, "zugang", { mode: 0o600 });
    assert.deepEqual(opened, [{ file: `${file}.tmp`, flags: "wx", mode: 0o600, modeAtOpen: 0o600, size: 0 }]);
    assert.equal(modeOf(file), 0o600);
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    process.umask(before);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Mit Rechten: Weitere Rechte einer alten Datei oder eines liegengebliebenen Rests gehen nicht ueber", async () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "liste.json");
    writeFileSync(file, "alt");
    chmodSync(file, 0o644);
    writeFileSync(`${file}.tmp`, "halb geschrie");
    chmodSync(`${file}.tmp`, 0o666);
    await writeFileAtomic(file, "neu", { mode: 0o600 });
    assert.equal(modeOf(file), 0o600);
    assert.equal(readFileSync(file, "utf8"), "neu");
    assert.equal(existsSync(`${file}.tmp`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Mit Rechten: Eine strengere Maske des Prozesses nimmt dem Besitzer nichts weg", async () => {
  const dir = tmpDir();
  const before = process.umask(0o277);
  try {
    const file = path.join(dir, "liste.json");
    await writeFileAtomic(file, "neu", { mode: 0o600 });
    assert.equal(modeOf(file), 0o600);
    await writeFileAtomic(file, "neuer", { mode: 0o600 });
    assert.equal(readFileSync(file, "utf8"), "neuer");
  } finally {
    process.umask(before);
    rmSync(dir, { recursive: true, force: true });
  }
});
