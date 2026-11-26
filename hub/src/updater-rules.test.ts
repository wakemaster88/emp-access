import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PREFLIGHT_ENV,
  PREFLIGHT_OK,
  RESTART_HOLD_MAX_MS,
  RESTART_POLL_MS,
  RESTART_QUIET_MAX_MS,
  installCommand,
  quietWaitLine,
  restartAllowed,
  quietStep,
  restartStep,
  type RestartActivity,
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

test("Neustart nach einem Update wartet auf laufende Bewertungen des Wächters, höchstens 3 min", () => {
  assert.equal(RESTART_HOLD_MAX_MS, 3 * 60_000);
  // Nichts laeuft: sofort, ohne Zeile.
  assert.deepEqual(restartStep(0, 0, 0), { then: "neustart", line: null });
  // Eine Bewertung laeuft: warten, eine Zeile beim ersten Schritt.
  assert.deepEqual(restartStep(1, 0, 0), {
    then: "warten",
    line: "Update: Neustart wartet auf 1 laufende Bewertung(en) des Wächters (höchstens 3 min)",
  });
  assert.deepEqual(restartStep(1, 30_000, 15), { then: "warten", line: null });
  // Fertig: Neustart mit Zeile.
  assert.deepEqual(restartStep(0, 42_000, 21), { then: "neustart", line: "Update: Bewertung des Wächters abgeschlossen, Neustart nach 42 s Warten" });
  // Nach 3 min in jedem Fall.
  assert.equal(restartStep(2, RESTART_HOLD_MAX_MS, 90).then, "neustart");
  assert.match(restartStep(2, RESTART_HOLD_MAX_MS, 90).line ?? "", /obwohl noch 2 Bewertung\(en\)/);
  // Die Uhr springt zurueck: Die Zahl der Runden begrenzt das Warten.
  assert.equal(restartStep(1, -600_000, Math.ceil(RESTART_HOLD_MAX_MS / RESTART_POLL_MS)).then, "neustart");
  assert.equal(restartStep(1, -600_000, 10).then, "warten");
});

const idle: RestartActivity = { burstsAktiv: 0, ansageLaeuft: false, tasksLaufend: 0 };

test("restartAllowed: wartet auf Kennzeichen-Burst, Ansage und Auftrag, hoechstens 2 min", () => {
  assert.equal(RESTART_QUIET_MAX_MS, 2 * 60_000);
  assert.deepEqual(restartAllowed({ ...idle, wartetSeitMs: 0 }), { allowed: true, waitingFor: [], timedOut: false });
  assert.deepEqual(restartAllowed({ burstsAktiv: 1, ansageLaeuft: true, tasksLaufend: 3, wartetSeitMs: 5_000 }), {
    allowed: false,
    waitingFor: ["Kennzeichen-Burst", "Ansage", "Auftrag"],
    timedOut: false,
  });
  assert.equal(restartAllowed({ ...idle, burstsAktiv: 2, wartetSeitMs: RESTART_QUIET_MAX_MS - 1 }).allowed, false);
  assert.equal(restartAllowed({ ...idle, ansageLaeuft: true, wartetSeitMs: 0 }).allowed, false);
  assert.equal(restartAllowed({ ...idle, tasksLaufend: 1, wartetSeitMs: 0 }).allowed, false);
  assert.deepEqual(restartAllowed({ ...idle, tasksLaufend: 1, wartetSeitMs: RESTART_QUIET_MAX_MS }), {
    allowed: true,
    waitingFor: ["Auftrag"],
    timedOut: true,
  });
});

test("quietWaitLine: eine Zeile, wie lange und worauf", () => {
  assert.equal(quietWaitLine([], 30_000, []), null);
  assert.equal(quietWaitLine(["Auftrag"], 14_400, []), "Update: Neustart nach 14 s Warten auf Auftrag");
  assert.equal(
    quietWaitLine(["Kennzeichen-Burst", "Ansage", "Auftrag"], 8_000, []),
    "Update: Neustart nach 8 s Warten auf Kennzeichen-Burst, Ansage und Auftrag"
  );
  assert.equal(
    quietWaitLine(["Kennzeichen-Burst", "Auftrag"], RESTART_QUIET_MAX_MS, ["Auftrag"]),
    "Update: Neustart nach 120 s Warten auf Kennzeichen-Burst und Auftrag – Höchstdauer 2 min erreicht, noch aktiv: Auftrag"
  );
});

/** Schritte ablaufen lassen wie updater.ts: alle 2 s einer, `at(t)` liefert den Stand. */
function runQuiet(at: (t: number) => RestartActivity, clock = (t: number) => t) {
  let waitedFor: string[] = [];
  for (let round = 0; round < 1_000; round++) {
    const t = round * RESTART_POLL_MS;
    const step = quietStep({ activity: at(t), waitedMs: clock(t), round, waitedFor });
    waitedFor = step.waitedFor;
    if (step.then === "weiter") return { t, line: step.line };
  }
  throw new Error("kein Ende");
}

test("quietStep: nichts laeuft – sofort weiter, ohne Zeile", () => {
  assert.deepEqual(runQuiet(() => idle), { t: 0, line: null });
});

test("quietStep: Burst und Auftrag enden, danach weiter mit einer Zeile", () => {
  const r = runQuiet((t) => ({ burstsAktiv: t < 6_000 ? 1 : 0, ansageLaeuft: false, tasksLaufend: t < 12_000 ? 1 : 0 }));
  assert.deepEqual(r, { t: 12_000, line: "Update: Neustart nach 12 s Warten auf Kennzeichen-Burst und Auftrag" });
  // Was nacheinander lief, steht in fester Reihenfolge in der Zeile.
  const later = runQuiet((t) => ({ burstsAktiv: t >= 4_000 && t < 8_000 ? 1 : 0, ansageLaeuft: t < 4_000, tasksLaufend: 0 }));
  assert.equal(later.line, "Update: Neustart nach 8 s Warten auf Kennzeichen-Burst und Ansage");
});

test("quietStep: hoechstens 2 min, auch bei zurueckgestellter Uhr", () => {
  const busy = () => ({ ...idle, ansageLaeuft: true });
  assert.deepEqual(runQuiet(busy), {
    t: RESTART_QUIET_MAX_MS,
    line: "Update: Neustart nach 120 s Warten auf Ansage – Höchstdauer 2 min erreicht, noch aktiv: Ansage",
  });
  // Uhr springt um 10 min zurueck: Die Runden begrenzen das Warten.
  assert.equal(runQuiet(busy, (t) => t - 600_000).t, RESTART_QUIET_MAX_MS);
  // Uhr springt vor: lieber frueher neu starten.
  assert.equal(runQuiet(busy, (t) => t + 600_000).t, 0);
});
