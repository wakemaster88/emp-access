import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIGHT_MARK_MAX_AGE_MS,
  LIGHT_MIN_FRAMES_DEFAULT,
  burstSwitchesLight,
  isDark,
  ledText,
  lightDecision,
  lightMarkStep,
  lightMinFrames,
  lightMuteDue,
  lightSkipLogged,
  lightSkipText,
  spotlightWanted,
  type LightFacts,
} from "./vehicle-light-rules.js";

// 14.11.2026 Beckum: Aufgang ca. 07:50, Untergang ca. 16:35 Berlin.
const DAYS = [
  { sunrise: "2026-11-14T06:50:00Z", sunset: "2026-11-14T15:35:00Z" },
  { sunrise: "2026-11-15T06:52:00Z", sunset: "2026-11-15T15:34:00Z" },
];

test("18 Uhr Berlin im November ist dunkel", () => {
  assert.equal(isDark(new Date("2026-11-14T17:02:00Z"), DAYS), true);
});

test("Mittag ist hell", () => {
  assert.equal(isDark(new Date("2026-11-14T10:07:00Z"), DAYS), false);
});

test("Dämmerung kurz vor Sonnenuntergang zählt schon als dunkel", () => {
  assert.equal(isDark(new Date("2026-11-14T15:15:00Z"), DAYS), true);
});

test("früh morgens vor Aufgang ist dunkel", () => {
  assert.equal(isDark(new Date("2026-11-15T06:10:00Z"), DAYS), true);
});

test("ohne Wetterdaten: feste Zeiten", () => {
  assert.equal(isDark(new Date("2026-11-14T17:30:00Z"), []), true);
  assert.equal(isDark(new Date("2026-11-14T11:00:00Z"), []), false);
});

test("Standard: nur Zufahrtskameras mit Weißlicht", () => {
  assert.equal(spotlightWanted({ id: 9, name: "Kamera Eingang" }, true, undefined), true);
  assert.equal(spotlightWanted({ id: 9, name: "Kamera Eingang" }, false, undefined), false);
  assert.equal(spotlightWanted({ id: 4, name: "Kamera Halle" }, true, undefined), false);
  assert.equal(spotlightWanted({ id: 5, name: "Kamera Torhaus" }, true, undefined), false);
});

test("Umgebung: aus oder feste IDs", () => {
  assert.equal(spotlightWanted({ id: 9, name: "Kamera Eingang" }, true, "0"), false);
  assert.equal(spotlightWanted({ id: 4, name: "Kamera Halle" }, true, "4, 9"), true);
  assert.equal(spotlightWanted({ id: 9, name: "Kamera Eingang" }, true, "4"), false);
});

test("Burst im Dunkeln: ein Licht, das aus ist, schaltet er selbst; eines, das schon brennt, lässt er, wie es ist", () => {
  assert.equal(burstSwitchesLight({ lit: false, goingOff: false }), true);
  // Von Hand eingeschaltet: nutzen, nicht anfassen, am Ende nicht ausschalten.
  assert.equal(burstSwitchesLight({ lit: true, goingOff: false }), false);
});

test("Burst im Dunkeln: schaltet der Hub das brennende Licht gerade selbst aus, schaltet der Burst es wieder ein", () => {
  // Die Kamera meldet es noch als brennend, beim ersten Bild wäre es aus.
  assert.equal(burstSwitchesLight({ lit: true, goingOff: true }), true);
  // Der Befehl hat schon gewirkt: ein Burst im Dunkeln wie jeder andere.
  assert.equal(burstSwitchesLight({ lit: false, goingOff: true }), true);
});

// Gemerktes Licht des vorigen Prozesses: vor 20 s eingeschaltet, Kamera bekannt und erreichbar.
const NOW = Date.parse("2026-11-25T18:00:00Z");
const LEFT_ON = { now: NOW, markedAt: NOW - 20_000, known: true, reachable: true, inUse: false, lastTryAt: 0 };

test("Gemerktes Licht: ausschalten, sobald die Kamera bekannt und erreichbar ist", () => {
  assert.equal(lightMarkStep(LEFT_ON), "off");
  // Kamera-Liste noch nicht geladen oder Kamera daraus entfernt: warten, nichts verwerfen.
  assert.equal(lightMarkStep({ ...LEFT_ON, known: false, reachable: false }), "wait");
  // Bekannt, aber sie antwortet nicht: warten, bis sie wieder da ist.
  assert.equal(lightMarkStep({ ...LEFT_ON, reachable: false }), "wait");
});

test("Gemerktes Licht: solange an der Kamera ein Burst läuft, bleibt es an", () => {
  assert.equal(lightMarkStep({ ...LEFT_ON, inUse: true }), "wait");
  // Auch ein alter Merker wartet das Ende des Bursts ab.
  assert.equal(lightMarkStep({ ...LEFT_ON, markedAt: NOW - LIGHT_MARK_MAX_AGE_MS - 1, inUse: true }), "wait");
});

test("Gemerktes Licht: scheitert das Ausschalten, kommt der nächste Versuch nach einer Minute", () => {
  assert.equal(lightMarkStep({ ...LEFT_ON, lastTryAt: NOW - 2_000 }), "wait");
  assert.equal(lightMarkStep({ ...LEFT_ON, lastTryAt: NOW - 59_999 }), "wait");
  assert.equal(lightMarkStep({ ...LEFT_ON, lastTryAt: NOW - 60_000 }), "off");
});

test("Gemerktes Licht: nach 24 h wird der Merker verworfen und die Kamera nicht mehr angefasst", () => {
  assert.equal(lightMarkStep({ ...LEFT_ON, markedAt: NOW - LIGHT_MARK_MAX_AGE_MS }), "off");
  assert.equal(lightMarkStep({ ...LEFT_ON, markedAt: NOW - LIGHT_MARK_MAX_AGE_MS - 1 }), "drop");
  // Gilt auch für eine Kamera, die es nicht mehr gibt oder die nicht antwortet.
  assert.equal(lightMarkStep({ ...LEFT_ON, markedAt: NOW - 25 * 3_600_000, known: false, reachable: false }), "drop");
  assert.equal(lightMarkStep({ ...LEFT_ON, markedAt: NOW - 25 * 3_600_000, reachable: false }), "drop");
});

// Abend des 14.11.2026, 18:02 Uhr Berlin.
const NOW_ABEND = Date.parse("2026-11-14T17:02:00Z");
const EINGANG = { id: 9, name: "Kamera Eingang" };
/** Alles bekannt, alles spricht für Licht. */
const ALL: LightFacts = {
  env: undefined,
  cam: EINGANG,
  now: NOW_ABEND,
  mutedUntil: null,
  dark: true,
  hasLight: true,
  led: { state: 0, mode: 1 },
  alarm: true,
};

test("Licht: dunkel, Zufahrtskamera mit Weißlicht, Licht aus, Alarm steht → an", () => {
  assert.deepEqual(lightDecision(ALL), { light: "on" });
});

test("Licht: je Grund ein Fall", () => {
  assert.deepEqual(lightDecision({ ...ALL, env: "0" }), { light: "off", reason: "off" });
  assert.deepEqual(lightDecision({ ...ALL, env: " Aus " }), { light: "off", reason: "off" });
  assert.deepEqual(lightDecision({ ...ALL, mutedUntil: NOW_ABEND + 60_000 }), { light: "off", reason: "muted" });
  assert.deepEqual(lightDecision({ ...ALL, dark: false }), { light: "off", reason: "day" });
  assert.deepEqual(lightDecision({ ...ALL, cam: { id: 4, name: "Kamera Halle" } }), {
    light: "off",
    reason: "not_selected",
  });
  assert.deepEqual(lightDecision({ ...ALL, env: "4" }), { light: "off", reason: "not_selected" });
  assert.deepEqual(lightDecision({ ...ALL, hasLight: false }), { light: "off", reason: "no_light" });
  assert.deepEqual(lightDecision({ ...ALL, led: { state: 1, mode: 1 } }), { light: "off", reason: "already_on" });
  assert.deepEqual(lightDecision({ ...ALL, alarm: false }), { light: "off", reason: "alarm_gone" });
});

test("Licht: abgelaufene Sperre zählt nicht mehr", () => {
  assert.deepEqual(lightDecision({ ...ALL, mutedUntil: NOW_ABEND - 1 }), { light: "on" });
  assert.deepEqual(lightDecision({ ...ALL, mutedUntil: NOW_ABEND }), { light: "on" });
});

test("Licht: Reihenfolge – erst was nichts kostet, dann Wetter, dann die Kamera", () => {
  const base: LightFacts = { env: undefined, cam: EINGANG, now: NOW_ABEND };
  // Abgeschaltet oder gesperrt: entschieden, ohne irgendetwas abzufragen.
  assert.deepEqual(lightDecision({ ...base, env: "off" }), { light: "off", reason: "off" });
  assert.deepEqual(lightDecision({ ...base, mutedUntil: NOW_ABEND + 1 }), { light: "off", reason: "muted" });
  // Abgeschaltet geht vor Sperre.
  assert.deepEqual(lightDecision({ ...base, env: "0", mutedUntil: NOW_ABEND + 1 }), { light: "off", reason: "off" });
  // Sonst der Reihe nach: Dunkelheit, Weißlicht vorhanden, Licht-Zustand, Alarm.
  assert.deepEqual(lightDecision(base), { light: "need", fact: "dark" });
  assert.deepEqual(lightDecision({ ...base, dark: true }), { light: "need", fact: "hasLight" });
  assert.deepEqual(lightDecision({ ...base, dark: true, hasLight: true }), { light: "need", fact: "led" });
  assert.deepEqual(lightDecision({ ...base, dark: true, hasLight: true, led: { state: 0 } }), {
    light: "need",
    fact: "alarm",
  });
  assert.deepEqual(lightDecision({ ...base, dark: true, hasLight: true, led: { state: 0 }, alarm: true }), {
    light: "on",
  });
});

test("Licht: bei Tag und an nicht gemeinten Kameras keine Abfrage an die Kamera", () => {
  const base: LightFacts = { env: undefined, cam: EINGANG, now: NOW_ABEND };
  assert.deepEqual(lightDecision({ ...base, dark: false }), { light: "off", reason: "day" });
  // Kamera Halle ist nicht gemeint: entschieden, bevor nach ihrem Weißlicht gefragt wird.
  assert.deepEqual(lightDecision({ ...base, cam: { id: 4, name: "Kamera Halle" }, dark: true }), {
    light: "off",
    reason: "not_selected",
  });
  // Feste IDs: nur diese Kameras, dann aber unabhängig vom Namen.
  assert.deepEqual(lightDecision({ ...base, env: "4, 9", cam: { id: 4, name: "Kamera Halle" }, dark: true }), {
    light: "need",
    fact: "hasLight",
  });
});

test("Licht: nicht lesbare Angaben der Kamera verhindern das Licht nicht", () => {
  assert.deepEqual(lightDecision({ ...ALL, led: null }), { light: "on" });
  assert.deepEqual(lightDecision({ ...ALL, alarm: null }), { light: "on" });
  assert.deepEqual(lightDecision({ ...ALL, led: {} }), { light: "on" });
});

test("Licht: ohne lesbare Fähigkeiten bleibt es aus (wie ohne Weißlicht)", () => {
  assert.deepEqual(lightDecision({ ...ALL, hasLight: null }), { light: "off", reason: "no_light" });
  assert.equal(lightSkipText("no_light", { hasLight: null }), "Fähigkeiten der Kamera nicht lesbar");
});

test("Licht: brennt es, weil der Hub ein gemerktes Licht gerade ausschaltet, schaltet der Burst es selbst", () => {
  assert.deepEqual(lightDecision({ ...ALL, led: { state: 1, mode: 1 }, goingOff: true }), { light: "on" });
  assert.deepEqual(lightDecision({ ...ALL, led: { state: 1, mode: 1 }, goingOff: false }), {
    light: "off",
    reason: "already_on",
  });
});

test("Licht: Grund als Text für die Log-Zeile", () => {
  // Sperre bis 18:07 Uhr Berlin (17:07 UTC im Winter).
  assert.equal(lightSkipText("muted", { mutedUntil: Date.parse("2026-11-14T17:07:30Z") }), "gesperrt bis 18:07");
  assert.equal(lightSkipText("already_on", { led: { state: 1, mode: 1 } }), "Licht laut Kamera schon an (state=1, mode=1)");
  assert.equal(lightSkipText("alarm_gone", {}), "Alarm schon vorbei");
  assert.equal(lightSkipText("off", {}), "per HUB_VEHICLE_SPOTLIGHT abgeschaltet");
  assert.equal(lightSkipText("not_selected", {}), "Kamera nicht für das Weißlicht vorgesehen");
  assert.equal(lightSkipText("no_light", { hasLight: false }), "Kamera ohne Weißlicht");
  assert.equal(lightSkipText("exiting", {}), "Hub wird beendet");
  assert.equal(ledText({ state: 0, mode: 1 }), "state=0, mode=1");
  assert.equal(ledText({ state: 0 }), "state=0, mode=?");
  assert.equal(ledText(null), "Zustand nicht lesbar");
});

test("Licht: die Zeile steht nur im Dunkeln im Log, bei Tag keine", () => {
  const never = () => {
    throw new Error("darf nicht gefragt werden");
  };
  assert.equal(lightSkipLogged({ dark: true, darkWithoutFetch: never }), true);
  assert.equal(lightSkipLogged({ dark: false, darkWithoutFetch: never }), false);
  // Abgeschaltet oder gesperrt: entschieden vor der Dunkelheit, dann zählt der letzte Wetterbericht.
  assert.equal(lightSkipLogged({ darkWithoutFetch: () => true }), true);
  assert.equal(lightSkipLogged({ darkWithoutFetch: () => false }), false);
});

test("Licht-Sperre: nur nach mindestens einem ausgewerteten Bild ohne Kennzeichen und Fahrzeug", () => {
  // Erstes Bild nicht abrufbar: nichts ausgewertet, keine Sperre.
  assert.equal(lightMuteDue({ evaluated: 0, shown: false }), false);
  // Ein Bild gelesen, nichts darauf: Sperre (auch wenn das zweite Bild nicht abrufbar war).
  assert.equal(lightMuteDue({ evaluated: 1, shown: false }), true);
  assert.equal(lightMuteDue({ evaluated: 8, shown: false }), true);
  assert.equal(lightMuteDue({ evaluated: 14, shown: false }), true);
  // Irgendein Bild zeigte Kennzeichen oder Fahrzeug: keine Sperre.
  assert.equal(lightMuteDue({ evaluated: 1, shown: true }), false);
  assert.equal(lightMuteDue({ evaluated: 8, shown: true }), false);
  // Mindestzahl 0: wie ohne Mindestzahl.
  assert.equal(lightMuteDue({ evaluated: 1, shown: false, minFrames: 0 }), true);
  assert.equal(lightMuteDue({ evaluated: 0, shown: false, minFrames: 0 }), false);
});

test("Licht-Sperre mit Mindestzahl: erst nach so vielen ausgewerteten Bildern ohne Fund", () => {
  // Nach 2 Bildern nicht mehr abrufbar (Netzaussetzer): keine Sperre für das nächste Fahrzeug.
  assert.equal(lightMuteDue({ evaluated: 2, shown: false, minFrames: 8 }), false);
  assert.equal(lightMuteDue({ evaluated: 7, shown: false, minFrames: 8 }), false);
  // Mindestzahl erreicht, nichts gefunden: Sperre.
  assert.equal(lightMuteDue({ evaluated: 8, shown: false, minFrames: 8 }), true);
  assert.equal(lightMuteDue({ evaluated: 12, shown: false, minFrames: 8 }), true);
  // Mit Fund nie.
  assert.equal(lightMuteDue({ evaluated: 8, shown: true, minFrames: 8 }), false);
});

test("HUB_VEHICLE_LIGHT_MIN_FRAMES: Standard 8, 0 schaltet ab, begrenzt auf 0 bis zur Bildzahl des Bursts", () => {
  assert.equal(LIGHT_MIN_FRAMES_DEFAULT, 8);
  assert.equal(lightMinFrames(undefined, 20), 8);
  assert.equal(lightMinFrames("", 20), 8);
  assert.equal(lightMinFrames("  ", 20), 8);
  assert.equal(lightMinFrames("abc", 20), 8);
  assert.equal(lightMinFrames("0", 20), 0);
  assert.equal(lightMinFrames("-3", 20), 0);
  assert.equal(lightMinFrames("8", 20), 8);
  assert.equal(lightMinFrames("8.9", 20), 8);
  assert.equal(lightMinFrames("12", 20), 12);
  assert.equal(lightMinFrames("50", 20), 20);
  // Kurzer Burst (Weitwinkel, 3 Bilder): nie mehr als der Burst hat.
  assert.equal(lightMinFrames(undefined, 3), 3);
  assert.equal(lightMinFrames("8", 3), 3);
});
