/**
 * Prueft die Geraete-Bedienelemente (`src/lib/device-controls.ts`) gegen die
 * Annahme-Regel des Action-Endpunkts (`src/lib/device-open.ts`).
 *
 * Die entscheidende Zusicherung: Jeder Knopf, den die API einem fremden System
 * meldet, wird von `POST /api/devices/[id]/action` auch angenommen. Beide
 * Listen liegen in verschiedenen Dateien und koennten sonst auseinanderlaufen.
 *
 * Ausfuehren: npx tsx scripts/device-controls-check.ts
 */

import {
  deviceControlModel,
  deviceControls,
  availableDeviceActions,
} from "../src/lib/device-controls";
import {
  isActionAllowedForDevice,
  isValidDeviceAction,
  shellyAutoOffSec,
} from "../src/lib/device-open";
import { DEFAULT_PULSE_SECONDS } from "../src/lib/pulse-constants";

const TYPES = [
  "RASPBERRY_PI", "SHELLY", "NUKI_SMARTLOCK", "LOQED_SMARTLOCK",
  "GARDENA_VALVE", "AUDIO_PLAYER",
];
const CATEGORIES = [
  "DREHKREUZ", "TUER", "SENSOR", "SCHALTER", "BELEUCHTUNG", "AUDIO",
  "MARKISE", "ROLLTOR", "TASTER", null,
];

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) {
    failed++;
    console.log(` FEHL  ${label}${detail ? ` – ${detail}` : ""}`);
  }
}

console.log("Bedienelemente je Typ/Kategorie:\n");

for (const type of TYPES) {
  for (const category of CATEGORIES) {
    const device = { type, category };
    const model = deviceControlModel(device);
    const controls = deviceControls(device);
    const accepted = availableDeviceActions(device);

    // 1) Jeder angebotene Knopf muss auch angenommen werden.
    for (const c of controls) {
      check(
        `${type}/${category}: ${c.action} angeboten aber abgelehnt`,
        isValidDeviceAction(c.action) && isActionAllowedForDevice(c.action, device),
      );
      check(`${type}/${category}: ${c.action} fehlt in actions`, accepted.includes(c.action));
      check(`${type}/${category}: ${c.action} ohne Beschriftung`, c.label.trim().length > 0);
    }

    // 2) Genau ein Hauptbefehl, und der steht vorn.
    const primaries = controls.filter((c) => c.role === "primary");
    check(
      `${type}/${category}: ${primaries.length} Hauptbefehle`,
      controls.length === 0 ? primaries.length === 0 : primaries.length === 1,
    );
    check(
      `${type}/${category}: Hauptbefehl nicht an erster Stelle`,
      controls.length === 0 || controls[0].role === "primary",
    );

    // 3) Keine Aktion doppelt.
    check(
      `${type}/${category}: doppelte Aktion`,
      new Set(controls.map((c) => c.action)).size === controls.length,
    );

    const shown = controls.length === 0
      ? "— (keine Bedienung)"
      : controls.map((c) => `${c.label} [${c.action}${c.role === "primary" ? "" : `/${c.role}`}]`).join("  ·  ");
    console.log(`  ${type.padEnd(15)} ${String(category).padEnd(12)} ${model.padEnd(9)} ${shown}`);
  }
}

// 4) Die Faelle, auf die es fachlich ankommt.
const cases: Array<[string, { type: string; category: string | null }, string[]]> = [
  ["Markise", { type: "SHELLY", category: "MARKISE" }, ["open", "stop", "close"]],
  ["Rolltor", { type: "SHELLY", category: "ROLLTOR" }, ["open", "stop", "close"]],
  ["Drehkreuz", { type: "RASPBERRY_PI", category: "DREHKREUZ" }, ["open", "emergency"]],
  ["Tuer", { type: "RASPBERRY_PI", category: "TUER" }, ["open"]],
  ["Schalter", { type: "SHELLY", category: "SCHALTER" }, ["open", "reset"]],
  ["Taster", { type: "SHELLY", category: "TASTER" }, ["open", "reset"]],
  ["Smart Lock", { type: "NUKI_SMARTLOCK", category: "TUER" }, ["open", "deactivate"]],
  // Das LOQED hat drei Riegelzustaende, deshalb einen Knopf mehr als ein Nuki.
  ["LOQED", { type: "LOQED_SMARTLOCK", category: "TUER" }, ["open", "reset", "deactivate"]],
  ["Ventil", { type: "GARDENA_VALVE", category: null }, ["open", "reset"]],
  ["Sensor", { type: "SHELLY", category: "SENSOR" }, []],
  ["Audio-Zone", { type: "AUDIO_PLAYER", category: "AUDIO" }, []],
];

console.log("");
for (const [label, device, expected] of cases) {
  const actual = deviceControls(device).map((c) => c.action);
  const ok = actual.join(",") === expected.join(",");
  console.log(`${ok ? "  ok  " : " FEHL "} ${label}: ${actual.join(", ") || "keine Bedienung"}`);
  if (!ok) {
    failed++;
    console.log(`        erwartet: ${expected.join(", ") || "keine"}`);
  }
}

// 5) Markise und Rolltor muessen unterschiedlich beschriftet sein – sonst
//    steht an einer Markise "Öffnen" statt "Ausfahren".
const markise = deviceControls({ type: "SHELLY", category: "MARKISE" });
const rolltor = deviceControls({ type: "SHELLY", category: "ROLLTOR" });
const labelsDiffer = markise[0].label !== rolltor[0].label;
console.log(
  `${labelsDiffer ? "  ok  " : " FEHL "} Beschriftung je Antrieb: Markise "${markise[0].label}", Rolltor "${rolltor[0].label}"`,
);
if (!labelsDiffer) failed++;

// 6) Auto-Off-Timer des Shelly. Hier liegt der fachliche Unterschied zwischen
//    Taster (faellt nach der eingestellten Dauer ab) und Schalter (bleibt an).
const timerCases: Array<[string, { category: string | null; pulseSeconds?: number | null }, "open" | "emergency" | "reset", number | undefined]> = [
  ["Taster mit 90 s", { category: "TASTER", pulseSeconds: 90 }, "open", 90],
  ["Taster ohne Dauer", { category: "TASTER", pulseSeconds: null }, "open", DEFAULT_PULSE_SECONDS],
  ["Taster ausschalten", { category: "TASTER", pulseSeconds: 90 }, "reset", undefined],
  ["Schalter bleibt an", { category: "SCHALTER" }, "open", undefined],
  ["Beleuchtung bleibt an", { category: "BELEUCHTUNG" }, "open", undefined],
  ["Tuer-Impuls", { category: "TUER" }, "open", 3],
  ["NOT-AUF ohne Timer", { category: "DREHKREUZ" }, "emergency", undefined],
];

console.log("");
for (const [label, device, action, expected] of timerCases) {
  const actual = shellyAutoOffSec(device, action);
  const ok = actual === expected;
  console.log(`${ok ? "  ok  " : " FEHL "} ${label}: ${actual ?? "kein Timer"}`);
  if (!ok) {
    failed++;
    console.log(`        erwartet: ${expected ?? "kein Timer"}`);
  }
}

console.log(failed === 0 ? "\nAlle Pruefungen bestanden." : `\n${failed} Pruefung(en) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
