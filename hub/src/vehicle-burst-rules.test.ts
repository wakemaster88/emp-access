import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIGHTING_MAX_BYTES,
  burstConsensus,
  burstDone,
  burstDoneReason,
  burstEndText,
  burstStep,
  consensusChange,
  firstFound,
  frameShowsPlate,
  pickFallbackFrame,
  sightingImageTooLarge,
  singleReadWeak,
  type FrameRead,
} from "./vehicle-burst-rules.js";
import { KNOWN_CITY } from "./plate-match.js";
import { UMLAUT_CITY_BY_PLAIN } from "./plate-cities.js";

const OPTS = { minConf: 0.8, knownCity: KNOWN_CITY };

/** Bild i mit einer Lesung (oder keiner). */
function burst(rows: Array<[string, number] | null>): FrameRead[] {
  return rows.map((r, index) => ({ index, candidates: r ? [{ plate: r[0], confidence: r[1] }] : [] }));
}

test("Kennzeichen aus der Region wird über den Burst erkannt (Befund 19.11.)", () => {
  const reads = burst([
    null, null, null, null, null, null, null, null,
    ["GT-AB 4321", 0.98], null, ["GT-AB 4321", 0.98], null, null,
    ["Y-AB 1234", 0.53], ["GT-AB 4321", 0.98], ["GT-AB 4321", 0.97], ["GT-AB 4321", 0.98],
    ["GT-AB 4321", 0.98], ["GT-AB 432", 0.97], ["GT-AB 4321", 0.98],
  ]);
  const c = burstConsensus(reads, OPTS);
  assert.ok(c);
  assert.equal(c.plate, "GT-AB 4321");
  assert.equal(c.frames, 8); // 7 volle + 1 abgeschnittene Lesung
  // Mittleres der sicheren Bilder, nicht das letzte.
  assert.ok(c.bestIndex > 8 && c.bestIndex < 19, `bestIndex ${c.bestIndex}`);
});

test("Mehrheit schlägt Einzel-Fehllesung (ST-K einmal, GT-K viermal)", () => {
  const reads = burst([
    ["ST-K 3434E", 0.91],
    ["GT-K 3434E", 0.95],
    ["GT-K 3434E", 0.96],
    ["GT-K 3434E", 0.97],
    ["B-TK 3434E", 0.92],
    ["GT-K 3434E", 0.95],
  ]);
  assert.equal(burstConsensus(reads, OPTS)?.plate, "GT-K 3434E");
});

test("zweistelliges Kennzeichen braucht drei Bilder (BE-AB 34)", () => {
  assert.equal(burstConsensus(burst([["BE-AB 34", 0.97], ["BE-AB 34", 0.97]]), OPTS), null);
  assert.equal(
    burstConsensus(burst([["BE-AB 34", 0.97], ["BE-AB 34", 0.97], ["BE-AB 34", 0.97]]), OPTS)?.plate,
    "BE-AB 34"
  );
});

test("einzelnes Bild: nur mit sehr hoher Confidence", () => {
  assert.equal(burstConsensus(burst([["PB-AB 2345", 0.9]]), OPTS), null);
  assert.equal(burstConsensus(burst([["PB-AB 2345", 0.97]]), OPTS)?.plate, "PB-AB 2345");
});

test("unsichere oder unbekannte Lesungen zählen nicht", () => {
  const reads = burst([["K-AB 123", 0.54], ["XQ-AB 123", 0.97], ["XQ-AB 123", 0.97], ["GR-AB 123", 0.56]]);
  assert.equal(burstConsensus(reads, OPTS), null);
});

test("Fallback-Bild: Schild sichtbar vor größter Box, nie einfach das letzte", () => {
  const reads = burst([null, ["SO-XZ 575E", 0.76], null, null]);
  assert.deepEqual(pickFallbackFrame(reads, [0.05, 0.04, 0.03, 0.02], 0), { index: 1, why: "ocr" });
  assert.deepEqual(pickFallbackFrame(burst([null, null, null]), [0.02, 0.09, 0.03], 0), { index: 1, why: "area" });
  assert.equal(pickFallbackFrame(burst([null, null]), [0, null], 0), null);
});

test("Burst endet nach bestätigtem Kennzeichen plus Nachlauf", () => {
  const rows: Array<[string, number] | null> = [null, ["PB-AB 2345", 0.97], ["PB-AB 2345", 0.96], ["PB-AB 2345", 0.97]];
  const reads = burst(rows);
  assert.equal(burstDone(reads, 4, { ...OPTS, afterFrames: 2 }), false);
  assert.equal(burstDone(reads, 5, { ...OPTS, afterFrames: 2 }), false);
  assert.equal(burstDone(reads, 6, { ...OPTS, afterFrames: 2 }), true);
  // Ohne bestätigtes Kennzeichen läuft der Burst weiter.
  assert.equal(burstDone(burst([["PB-AB 2345", 0.97], null, null, null]), 12, OPTS), false);
});

test("Mehrheit: ein einzelnes Bild mit einem Zeichen zu viel sammelt die richtigen Lesungen nicht ein", () => {
  const reads = burst([
    ["GT-AB 432", 0.95],
    ["GT-AB 432", 0.96],
    ["GT-AB 432", 0.97],
    ["GT-AB 432", 0.95],
    ["GT-AB 432", 0.94],
    ["GT-AB 4321", 0.82],
  ]);
  const c = burstConsensus(reads, OPTS);
  assert.ok(c);
  assert.equal(c.plate, "GT-AB 432");
  assert.equal(c.frames, 5);
  assert.equal(c.confidence, 0.97);
  assert.ok(c.bestIndex <= 4, `bestIndex ${c.bestIndex}`);
});

test("Mehrheit: ein E oder H am Ende auf nur einem Bild sammelt die richtigen Lesungen nicht ein", () => {
  const reads = burst([
    ["GT-AB 432", 0.95],
    ["GT-AB 432", 0.96],
    ["GT-AB 432", 0.97],
    ["GT-AB 432", 0.95],
    ["GT-AB 432", 0.94],
    ["GT-AB 432E", 0.82],
  ]);
  const e = burstConsensus(reads, OPTS);
  assert.equal(e?.plate, "GT-AB 432");
  assert.equal(e?.frames, 5);
  assert.ok((e?.bestIndex ?? 9) <= 4, `bestIndex ${e?.bestIndex}`);
  // Die frühere Regel hätte das E genommen: Das zählt der Hub mit.
  assert.deepEqual(consensusChange(reads, OPTS, e), { now: "GT-AB 432", before: "GT-AB 432E" });
  const h = burstConsensus(burst([["GT-AB 432", 0.95], ["GT-AB 432", 0.95], ["GT-AB 432H", 0.86]]), OPTS);
  assert.equal(h?.plate, "GT-AB 432");
});

test("Mehrheit: ein E oder H am Ende, das selbst trägt, bekommt die kürzeren Lesungen", () => {
  // Auf 2 Bildern: zusammen mit den drei kürzeren 5 Bilder.
  const twice = burstConsensus(
    burst([["PB-AB 234", 0.95], ["PB-AB 234E", 0.9], ["PB-AB 234", 0.95], ["PB-AB 234E", 0.91], ["PB-AB 234", 0.95]]),
    OPTS
  );
  assert.equal(twice?.plate, "PB-AB 234E");
  assert.equal(twice?.frames, 5);
  // Je einmal gelesen: so oft wie die kürzere.
  const once = burstConsensus(burst([["GT-AB 432", 0.95], ["GT-AB 432H", 0.9]]), OPTS);
  assert.equal(once?.plate, "GT-AB 432H");
  assert.equal(once?.frames, 2);
});

test("Mehrheit: abgeschnittene Lesungen zählen weiter für die längere, wenn diese selbst trägt", () => {
  // Länger auf 2 Bildern, kürzer auf 3: zusammen 5 für die längere.
  const twice = burstConsensus(
    burst([["GT-AB 432", 0.9], ["GT-AB 4321", 0.93], ["GT-AB 432", 0.9], ["GT-AB 4321", 0.94], ["GT-AB 432", 0.9]]),
    OPTS
  );
  assert.equal(twice?.plate, "GT-AB 4321");
  assert.equal(twice?.frames, 5);
  // Je einmal gelesen: Die längere steht auf so vielen Bildern wie die kürzere.
  const once = burstConsensus(burst([["GT-AB 432", 0.9], ["GT-AB 4321", 0.9]]), OPTS);
  assert.equal(once?.plate, "GT-AB 4321");
  assert.equal(once?.frames, 2);
});

test("Mehrheit: Abweichung von der früheren Regel wird erkannt, sonst nicht", () => {
  const extra = burst([
    ["GT-AB 432", 0.95],
    ["GT-AB 432", 0.96],
    ["GT-AB 432", 0.97],
    ["GT-AB 4321", 0.82],
  ]);
  assert.deepEqual(consensusChange(extra, OPTS, burstConsensus(extra, OPTS)), {
    now: "GT-AB 432",
    before: "GT-AB 4321",
  });
  // E am Ende nur auf einem Bild: früher mit E, jetzt ohne – das ist eine Abweichung.
  const e = burst([["PB-AB 234", 0.95], ["PB-AB 234", 0.95], ["PB-AB 234E", 0.83]]);
  assert.deepEqual(consensusChange(e, OPTS, burstConsensus(e, OPTS)), { now: "PB-AB 234", before: "PB-AB 234E" });
  // Früher ein Kennzeichen, jetzt keine Mehrheit (zwei Ziffern brauchen drei Bilder).
  const short = burst([["BE-AB 34", 0.9], ["BE-AB 34", 0.9], ["BE-AB 345", 0.9]]);
  assert.equal(burstConsensus(short, OPTS), null);
  assert.deepEqual(consensusChange(short, OPTS, null), { now: null, before: "BE-AB 345" });
  // Längere Lesung trägt selbst, oder gar keine längere: gleiches Ergebnis wie früher.
  const twice = burst([["GT-AB 432", 0.9], ["GT-AB 4321", 0.93], ["GT-AB 432", 0.9], ["GT-AB 4321", 0.94]]);
  assert.equal(consensusChange(twice, OPTS, burstConsensus(twice, OPTS)), null);
  const plain = burst([["GT-AB 4321", 0.97], ["GT-AB 4321", 0.96], null]);
  assert.equal(consensusChange(plain, OPTS, burstConsensus(plain, OPTS)), null);
  assert.equal(consensusChange(burst([null, null]), OPTS, null), null);
});

test("Mehrheit: zwei verschiedene Einzel-Lesungen ergeben keine", () => {
  assert.equal(burstConsensus(burst([["ST-K 3434", 0.85], ["GT-K 3434", 0.86]]), OPTS), null);
});

test("Einzelbild ohne Mehrheit unter der Schwelle wird gezählt, sonst nicht", () => {
  const base = { acted: false, consensus: false, plate: "GT-K 3434", listed: false, confidence: 0.86 };
  assert.equal(singleReadWeak(base), true);
  assert.equal(singleReadWeak({ ...base, confidence: 0.95 }), false);
  assert.equal(singleReadWeak({ ...base, consensus: true }), false);
  assert.equal(singleReadWeak({ ...base, acted: true }), false);
  assert.equal(singleReadWeak({ ...base, listed: true }), false);
  assert.equal(singleReadWeak({ ...base, plate: null }), false);
});

test("Burst endet zwei Bilder nach dem Bild, dessen Listen-Treffer geschaltet hat", () => {
  // Exakter Treffer nur auf Bild 3 (Index 2): keine drei gleichen Lesungen.
  const reads = burst([null, null, ["GT-AB 4321", 0.94], null, null]);
  const opts = { ...OPTS, afterFrames: 4 };
  assert.equal(burstDone(reads, 3, { ...opts, actedAtIndex: 2 }), false);
  assert.equal(burstDone(reads, 4, { ...opts, actedAtIndex: 2 }), false);
  assert.equal(burstDone(reads, 5, { ...opts, actedAtIndex: 2 }), true);
  // Die Lesung kam spät (OCR lief noch): Der Burst endet beim nächsten Bild.
  assert.equal(burstDone(reads, 9, { ...opts, actedAtIndex: 2 }), true);
  // Ohne geschalteten Treffer unverändert.
  assert.equal(burstDone(reads, 5, opts), false);
  assert.equal(burstDone(reads, 5, { ...opts, actedAtIndex: null }), false);
  // Einstellbarer Nachlauf.
  assert.equal(burstDone(reads, 3, { ...opts, actedAtIndex: 2, afterActedFrames: 0 }), true);
  assert.equal(burstDone(reads, 5, { ...opts, actedAtIndex: 2, afterActedFrames: 3 }), false);
});

test("Burst-Schritt: mit Alarm weiter, ohne Alarm Nachlauf, dann Ende", () => {
  const g = { graceFrames: 3 };
  assert.deepEqual(burstStep({ ...g, framesTaken: 0, alarm: true, graceLeft: 3 }), { next: "take", graceLeft: 3 });
  assert.deepEqual(burstStep({ ...g, framesTaken: 4, alarm: false, graceLeft: 3 }), { next: "take", graceLeft: 2 });
  assert.deepEqual(burstStep({ ...g, framesTaken: 6, alarm: false, graceLeft: 1 }), { next: "take", graceLeft: 0 });
  assert.deepEqual(burstStep({ ...g, framesTaken: 7, alarm: false, graceLeft: 0 }), { next: "end" });
  // Alarm kommt wieder: Nachlauf beginnt neu.
  assert.deepEqual(burstStep({ ...g, framesTaken: 7, alarm: true, graceLeft: 0 }), { next: "take", graceLeft: 3 });
});

test("Burst-Schritt: erstes Bild bei beendetem Alarm wird ausgewertet statt verworfen", () => {
  // Zeigt es etwas, ist es das erste Bild des Nachlaufs: noch zwei weitere.
  assert.deepEqual(burstStep({ framesTaken: 0, alarm: false, graceLeft: 3, graceFrames: 3 }), {
    next: "check",
    graceLeft: 2,
  });
  // Gilt mit und ohne Licht, solange keine Mindestzahl eingestellt ist.
  assert.deepEqual(burstStep({ framesTaken: 0, alarm: false, graceLeft: 3, graceFrames: 3, lightMinFrames: 0 }), {
    next: "check",
    graceLeft: 2,
  });
});

test("Burst-Schritt: Mindestzahl im Licht-Burst nimmt die ersten Bilder unabhängig vom Alarm", () => {
  let graceLeft = 3;
  const taken: string[] = [];
  // Alarm die ganze Zeit aus, Mindestzahl 8: genau 8 Bilder, dann Ende.
  for (let framesTaken = 0; framesTaken < 12; framesTaken++) {
    const step = burstStep({ framesTaken: taken.length, alarm: false, graceLeft, graceFrames: 3, lightMinFrames: 8 });
    if (step.next === "end") break;
    assert.equal(step.next, "take");
    graceLeft = step.graceLeft;
    taken.push("x");
  }
  assert.equal(taken.length, 8);
  // Meldet die Kamera das Fahrzeug zwischendurch wieder, gilt danach der normale Nachlauf.
  assert.deepEqual(burstStep({ framesTaken: 7, alarm: true, graceLeft: 0, graceFrames: 3, lightMinFrames: 8 }), {
    next: "take",
    graceLeft: 3,
  });
  assert.deepEqual(burstStep({ framesTaken: 8, alarm: false, graceLeft: 3, graceFrames: 3, lightMinFrames: 8 }), {
    next: "take",
    graceLeft: 2,
  });
});

/**
 * Burst nach burstStep durchspielen: `alarms[i]` = Alarm bei Bild i, `firstShows`
 * = das erste Bild zeigt Kennzeichen oder Fahrzeug. Ergebnis: aufgenommene
 * Bilder, oder -1, wenn der Burst beim ersten Bild ohne Fund aufgibt.
 */
function playBurst(alarms: boolean[], o: { grace: number; minFrames?: number; firstShows?: boolean; max?: number }): number {
  let graceLeft = o.grace;
  let taken = 0;
  for (let i = 0; i < (o.max ?? alarms.length); i++) {
    const step = burstStep({
      framesTaken: taken,
      alarm: alarms[i] ?? false,
      graceLeft,
      graceFrames: o.grace,
      ...(o.minFrames === undefined ? {} : { lightMinFrames: o.minFrames }),
    });
    if (step.next === "end") break;
    graceLeft = step.graceLeft;
    taken++;
    if (step.next === "check" && !o.firstShows) return -1;
  }
  return taken;
}

/** So lief die Schleife vor dem 25.11.2026 (Alarm aus beim ersten Bild: Bild verworfen, -1). */
function playBurstBefore(alarms: boolean[], grace: number): number {
  let graceLeft = grace;
  let taken = 0;
  for (let i = 0; i < alarms.length; i++) {
    if (!alarms[i]) {
      if (taken === 0) return -1;
      if (graceLeft <= 0) break;
      graceLeft--;
    } else {
      graceLeft = grace;
    }
    taken++;
  }
  return taken;
}

/** Alle Alarm-Folgen der Länge n. */
function allAlarmRuns(n: number): boolean[][] {
  const out: boolean[][] = [];
  for (let m = 0; m < 1 << n; m++) out.push(Array.from({ length: n }, (_, i) => ((m >> i) & 1) === 1));
  return out;
}

test("Burst-Schritt: mit Mindestzahl 0 wie ohne Licht und wie bisher, außer dem ersten Bild", () => {
  for (const alarms of allAlarmRuns(10)) {
    for (const firstShows of [false, true]) {
      // Mindestzahl 0 = keine Mindestzahl (Punkte a bis d unverändert).
      assert.equal(
        playBurst(alarms, { grace: 3, minFrames: 0, firstShows }),
        playBurst(alarms, { grace: 3, firstShows }),
        `${alarms.map(Number).join("")} ${firstShows}`
      );
    }
    // Steht der Alarm beim ersten Bild, ist alles wie vor der Änderung.
    if (alarms[0]) assert.equal(playBurst(alarms, { grace: 3, minFrames: 0 }), playBurstBefore(alarms, 3));
    // Ist er aus und zeigt das Bild nichts, gibt der Burst wie vorher beim ersten Bild auf.
    if (!alarms[0]) assert.equal(playBurst(alarms, { grace: 3, minFrames: 0, firstShows: false }), -1);
  }
});

test("Burst-Schritt: zeigt das erste Bild bei schon beendetem Alarm etwas, läuft der Nachlauf wie sonst", () => {
  // Alarm nie wieder an: Bild 1 und zwei weitere (Grace 3, Bild 1 zählt mit).
  assert.equal(playBurst([false, false, false, false, false, false], { grace: 3, firstShows: true }), 3);
  // Alarm kommt bei Bild 2 zurück: danach wie gewohnt bis drei Bilder nach dem letzten Alarm.
  assert.equal(playBurst([false, true, false, false, false, false, false], { grace: 3, firstShows: true }), 5);
});

test("Burst-Schritt: im Licht-Burst mit Mindestzahl 8 nie weniger als 8 Bilder, sonst wie bisher", () => {
  const off = Array<boolean>(20).fill(false);
  // Alarm schon beim ersten Bild aus (wie bei allen Licht-Bursts im Log vom 22.–24.11.): 8 Bilder.
  assert.equal(playBurst(off, { grace: 3, minFrames: 8 }), 8);
  // Das erste Bild wird nicht geprüft, sondern genommen: auch ohne Fund 8 Bilder.
  assert.equal(playBurst(off, { grace: 3, minFrames: 8, firstShows: false }), 8);
  // Alarm bis Bild 6: der Nachlauf danach reicht über die Mindestzahl hinaus.
  const sixOn = [true, true, true, true, true, true, ...Array<boolean>(14).fill(false)];
  assert.equal(playBurst(sixOn, { grace: 3, minFrames: 8 }), 9);
  assert.equal(playBurst(sixOn, { grace: 3, minFrames: 8 }), playBurstBefore(sixOn, 3));
  // Alarm durchgehend: Obergrenze des Bursts bleibt.
  assert.equal(playBurst(Array<boolean>(20).fill(true), { grace: 3, minFrames: 8 }), 20);
  // Kurzer Burst: Die Mindestzahl ist auf seine Obergrenze begrenzt (lightMinFrames), hier 3.
  assert.equal(playBurst(off.slice(0, 3), { grace: 3, minFrames: 3 }), 3);
});

test("Burst-Ende: Grund des vorzeitigen Endes", () => {
  const reads = burst([null, null, ["GT-AB 4321", 0.94], null, null]);
  assert.equal(burstDoneReason(reads, 5, { ...OPTS, actedAtIndex: 2 }), "acted");
  assert.equal(burstDoneReason(reads, 4, { ...OPTS, actedAtIndex: 2 }), null);
  const confirmed = burst([["PB-AB 2345", 0.97], ["PB-AB 2345", 0.96], ["PB-AB 2345", 0.97], null, null]);
  assert.equal(burstDoneReason(confirmed, 5, OPTS), "confirmed");
  assert.equal(burstDoneReason(confirmed, 4, OPTS), null);
});

test("Burst-Ende im Licht-Burst: vor der Mindestzahl nur nach einer Schaltung", () => {
  // Bild 1–3 lesen dasselbe Kennzeichen sicher, es schaltet nichts (nicht auf der Liste, Sperrzeit).
  const sure = burst([
    ["PB-AB 2345", 0.97],
    ["PB-AB 2345", 0.96],
    ["PB-AB 2345", 0.97],
    null, null, null, null, null, null,
  ]);
  const light = { ...OPTS, afterFrames: 2, minFrames: 8 };
  for (let n = 1; n < 8; n++) assert.equal(burstDoneReason(sure, n, light), null, `${n} Bilder`);
  assert.equal(burstDoneReason(sure, 8, light), "confirmed");
  // Ohne Mindestzahl (0 oder nicht gesetzt) wie bisher nach 5 Bildern.
  assert.equal(burstDoneReason(sure, 5, { ...light, minFrames: 0 }), "confirmed");
  assert.equal(burstDoneReason(sure, 5, { ...OPTS, afterFrames: 2 }), "confirmed");
  // Hat der Treffer von Bild 1 geschaltet, endet der Burst zwei Bilder später, auch vor der Mindestzahl.
  assert.equal(burstDoneReason(sure, 3, { ...light, actedAtIndex: 0 }), "acted");
  assert.equal(burstDoneReason(sure, 2, { ...light, actedAtIndex: 0 }), null);
});

test("Burst-Ende: eine Zeile mit Bildzahl und Grund", () => {
  assert.equal(burstEndText({ why: "alarm" }, 7), "VEHICLE ende nach 7 Frames");
  assert.equal(burstEndText({ why: "confirmed" }, 6), "Kennzeichen sicher – fertig nach 6 Frames");
  assert.equal(burstEndText({ why: "acted", actedAt: 2 }, 5), "geschaltet (Frame 3) – fertig nach 5 Frames");
  assert.equal(
    burstEndText({ why: "error", detail: "Snap fehlgeschlagen: HTTP 500" }, 4),
    "Abbruch nach 4 Frames – Bild nicht abrufbar: Snap fehlgeschlagen: HTTP 500"
  );
  assert.equal(burstEndText({ why: "max" }, 20), "Höchstzahl erreicht – fertig nach 20 Frames");
});

test("Bild zeigt Kennzeichen: angenommene oder Schild-artige Lesung", () => {
  assert.equal(frameShowsPlate({ plate: "GT-AB 4321", candidates: [] }), true);
  assert.equal(frameShowsPlate({ plate: null, candidates: [{ plate: "SO-XZ 575E", confidence: 0.5 }] }), true);
  assert.equal(frameShowsPlate({ plate: null, candidates: [{ plate: "X-Y 1", confidence: 0.49 }] }), false);
  assert.equal(frameShowsPlate({ plate: null, candidates: [{ plate: "X-Y 1", confidence: Number.NaN }] }), false);
  assert.equal(frameShowsPlate({ candidates: [] }), false);
});

test("Erstes Ergebnis zählt: wartet nicht auf die langsamere Prüfung", async () => {
  const never = new Promise<string | null>(() => {});
  assert.equal(await firstFound([never, Promise.resolve("Fahrzeug")]), "Fahrzeug");
  assert.equal(await firstFound<string>([Promise.resolve(null), Promise.resolve(null)]), null);
  assert.equal(await firstFound<string>([Promise.reject(new Error("x")), Promise.resolve(null)]), null);
  assert.equal(await firstFound<string>([Promise.reject(new Error("x")), Promise.resolve("Kennzeichen")]), "Kennzeichen");
  assert.equal(await firstFound<string>([]), null);
});

test("Bild über der Grenze der Cloud", () => {
  assert.equal(sightingImageTooLarge(SIGHTING_MAX_BYTES), false);
  assert.equal(sightingImageTooLarge(SIGHTING_MAX_BYTES + 1), true);
  assert.equal(sightingImageTooLarge(560_000), false);
});

test("Kreis mit Umlaut ohne Umlaut gelesen: Mehrheit zeigt die Form mit Umlaut", () => {
  const opts = { ...OPTS, umlautCity: UMLAUT_CITY_BY_PLAIN };
  const reads = burst([["LUD-AB 123", 0.93], ["LUD-AB 123", 0.95], null, ["LUD-AB 123", 0.94]]);
  const c = burstConsensus(reads, opts);
  assert.ok(c);
  assert.equal(c.plate, "LÜD-AB 123");
  assert.equal(c.frames, 3);
  // Bestätigt den Burst wie jeder bekannte Kreis.
  assert.equal(burstDoneReason(reads, 6, { ...opts, confirmFrames: 3, afterFrames: 2 }), "confirmed");
  // Ohne Zuordnung bleibt LUD ein unbekannter Kreis (bisheriges Verhalten).
  assert.equal(burstConsensus(reads, OPTS), null);
});

test("Kreis mit Umlaut: Lesung, die auch ein anderer Kreis sein kann, bleibt, wie gelesen", () => {
  const opts = { ...OPTS, umlautCity: UMLAUT_CITY_BY_PLAIN };
  // GOAB123: GÖ-AB 123 oder GOA-B 123 (St. Goar) – der Kreis der Liste gewinnt.
  const goa = burstConsensus(
    burst([["GOA-B 123", 0.95], ["GOA-B 123", 0.96]]).map((r) => ({
      index: r.index,
      candidates: [...r.candidates, { plate: "GO-AB 123", confidence: r.candidates[0].confidence }],
    })),
    opts
  );
  assert.equal(goa?.plate, "GOA-B 123");
  assert.equal(burstConsensus(burst([["GO-AB 123", 0.95], ["GO-AB 123", 0.96]]), opts), null);
  // Bochum bleibt Bochum.
  assert.equal(burstConsensus(burst([["BO-XY 474E", 0.95], ["BO-XY 474E", 0.96]]), opts)?.plate, "BO-XY 474E");
});
