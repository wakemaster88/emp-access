import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PREFLIGHT_ENV,
  PREFLIGHT_OK,
  installCommand,
  isPreflightRun,
  retryBlocked,
  signatureCheckEnabled,
} from "./updater-rules.js";

test("Installation: npm ci mit Lockfile, sonst npm install", () => {
  assert.deepEqual(installCommand(true).args.slice(0, 1), ["ci"]);
  assert.equal(installCommand(true).label, "npm ci");
  assert.deepEqual(installCommand(false).args.slice(0, 1), ["install"]);
  for (const has of [true, false]) {
    assert.ok(installCommand(has).args.includes("--no-audit"));
    assert.ok(installCommand(has).args.includes("--no-fund"));
  }
});

test("Signaturpruefung ist nur ausdruecklich eingeschaltet aktiv", () => {
  for (const off of [undefined, "", "0", "false", "off", "nein", " "]) {
    assert.equal(signatureCheckEnabled(off), false, String(off));
  }
  for (const on of ["1", "true", "TRUE", "on", "yes", "ja", " 1 "]) {
    assert.equal(signatureCheckEnabled(on), true, on);
  }
});

test("abgelehnter Stand: erst nach der Wartezeit oder mit neuem Commit erneut", () => {
  const wait = 30 * 60_000;
  const rejected = { rev: "aaa", at: 1_000_000 };
  assert.equal(retryBlocked(null, "aaa", 1_000_000, wait), false);
  assert.equal(retryBlocked(rejected, "aaa", 1_000_000 + 5 * 60_000, wait), true);
  assert.equal(retryBlocked(rejected, "aaa", 1_000_000 + wait, wait), false);
  assert.equal(retryBlocked(rejected, "bbb", 1_000_000 + 5 * 60_000, wait), false);
});

test("Pre-Flight-Vertrag: Namen bleiben stabil", () => {
  // Der laufende (alte) Updater kennt nur diese Namen – nie aendern.
  assert.equal(PREFLIGHT_ENV, "HUB_PREFLIGHT");
  assert.equal(PREFLIGHT_OK, "HUB_PREFLIGHT_OK");
  assert.equal(isPreflightRun({ HUB_PREFLIGHT: "1" }), true);
  assert.equal(isPreflightRun({ HUB_PREFLIGHT: "0" }), false);
  assert.equal(isPreflightRun({}), false);
});

test("index.ts beantwortet den Pre-Flight, bevor irgendetwas startet", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const guard = src.indexOf("if (isPreflightRun(process.env))");
  assert.ok(guard > 0, "Pre-Flight-Abfrage fehlt in index.ts");
  const body = src.slice(guard, guard + 400);
  assert.ok(body.includes("PREFLIGHT_OK"), "Pre-Flight bestaetigt nicht mit PREFLIGHT_OK");
  assert.ok(body.includes("process.exit(0)"), "Pre-Flight beendet den Prozess nicht");
  // Alles, was den Hub startet, steht dahinter.
  for (const start of ["EMP-Access-Hub startet", "startDashboard()", "setInterval(", "heartbeat();", "process.on("]) {
    const at = src.indexOf(start);
    assert.ok(at > guard, `„${start}“ steht vor der Pre-Flight-Abfrage`);
  }
  // Vor der Abfrage nur Importe und Kommentare.
  const before = src
    .slice(0, guard)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("import ") && !l.startsWith("/*") && !l.startsWith("*"));
  assert.deepEqual(before, []);
});
