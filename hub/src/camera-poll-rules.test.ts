import { test } from "node:test";
import assert from "node:assert/strict";
import { CameraLease, RunningReport, clockDriftKey, endHoldFor, endsToRetry, snapshotJobFor, type SnapshotGate } from "./camera-poll-rules.js";

const gate = (o: Partial<SnapshotGate> = {}): SnapshotGate => ({
  inFlight: false,
  now: 1_000_000,
  lastPipelineAt: 0,
  lastAutoAt: 0,
  throttleMs: 30_000,
  ...o,
});

test("Fahrzeug startet immer, auch mitten in einer Pipeline und direkt nach einem Bild", () => {
  assert.equal(snapshotJobFor("VEHICLE", gate({ inFlight: true, lastPipelineAt: 999_000, lastAutoAt: 999_000 })), "vehicle");
});

test("Person: ein reines Anzeige-Bild kurz davor sperrt die Gesichtserkennung nicht", () => {
  // Bewegung 2 s vorher hat ein Anzeige-Bild hochgeladen.
  assert.equal(snapshotJobFor("PERSON", gate({ lastAutoAt: 998_000 })), "person");
});

test("Person: nach einem Bild der Erkennungs-Pipeline gilt die Drossel weiter", () => {
  assert.equal(snapshotJobFor("PERSON", gate({ lastPipelineAt: 990_000 })), null);
  assert.equal(snapshotJobFor("PERSON", gate({ lastPipelineAt: 969_999 })), "person");
  assert.equal(snapshotJobFor("PERSON", gate({ inFlight: true })), null);
});

test("Bewegung und Tier: Anzeige-Bild hoechstens alle 30 s und nie direkt nach einer Pipeline", () => {
  assert.equal(snapshotJobFor("MOTION", gate()), "auto");
  assert.equal(snapshotJobFor("ANIMAL", gate({ lastAutoAt: 980_000 })), null);
  assert.equal(snapshotJobFor("MOTION", gate({ lastPipelineAt: 980_000 })), null);
  assert.equal(snapshotJobFor("MOTION", gate({ inFlight: true })), null);
  assert.equal(snapshotJobFor("MOTION", gate({ lastAutoAt: 969_999 })), "auto");
});

test("Nachlauf: nur Bewegung laeuft laenger nach, nie kuerzer als die anderen", () => {
  assert.equal(endHoldFor("MOTION", 6_000, 60_000), 60_000);
  assert.equal(endHoldFor("PERSON", 6_000, 60_000), 6_000);
  assert.equal(endHoldFor("VEHICLE", 6_000, 60_000), 6_000);
  assert.equal(endHoldFor("MOTION", 6_000, 0), 6_000);
});

test("Kamera-Uhren: wandernde Sekunden aendern die Aussage nicht, ein Sprung schon", () => {
  const a = clockDriftKey([
    { name: "A", offsetS: -32_374, ntp: false },
    { name: "B", offsetS: 14, ntp: true },
  ]);
  const b = clockDriftKey([
    { name: "B", offsetS: 19, ntp: true },
    { name: "A", offsetS: -32_391, ntp: false },
  ]);
  assert.equal(a, b);
  const c = clockDriftKey([
    { name: "A", offsetS: -2_083, ntp: false },
    { name: "B", offsetS: 14, ntp: true },
  ]);
  assert.notEqual(a, c);
});

const ev = (cameraId: number, type: string, phase: "start" | "end", at = 0) => ({ cameraId, type, phase, at });

test("Gescheiterte Meldung: jedes Ende geht noch einmal mit, kein Beginn", () => {
  // Ende von Kamera 7, dazu Beginn und Ende von Kamera 9 und ein zweites
  // Ereignis von Kamera 7. Ob die Cloud die Beginne kennt, weiss der Hub nicht
  // sicher (Zeitlimit), also gehen alle Enden noch einmal mit.
  const batch = [
    ev(7, "MOTION", "end", 20),
    ev(9, "PERSON", "start", 25),
    ev(9, "PERSON", "end", 30),
    ev(7, "MOTION", "start", 35),
    ev(7, "MOTION", "end", 40),
  ];
  const kept = endsToRetry(batch);
  assert.deepEqual(kept, [ev(7, "MOTION", "end", 20), ev(9, "PERSON", "end", 30), ev(7, "MOTION", "end", 40)]);
  // Dieselben Objekte in derselben Reihenfolge: Sie gehen vorn in die Warteschlange zurueck.
  assert.equal(kept[0], batch[0]);
  assert.equal(kept[2], batch[4]);
});

test("Gescheiterte Meldung: auch nach mehreren Versuchen bleibt jedes Ende genau einmal stehen", () => {
  const first = endsToRetry([ev(7, "MOTION", "end", 20), ev(7, "MOTION", "start", 35)]);
  // Zweiter Versuch: das zurueckgelegte Ende vorn, dahinter Neues.
  const second = endsToRetry([...first, ev(8, "VEHICLE", "start", 50), ev(7, "MOTION", "end", 60)]);
  assert.deepEqual(second, [ev(7, "MOTION", "end", 20), ev(7, "MOTION", "end", 60)]);
  assert.deepEqual(endsToRetry([ev(8, "VEHICLE", "start", 50)]), []);
  assert.deepEqual(endsToRetry([]), []);
});

/** Kamera-Vergabe mit einem Fahrzeug, das ab `waiting = true` wartet. */
function lease() {
  const st = { waiting: false, released: 0 };
  const l = new CameraLease(
    () => st.waiting,
    () => {
      st.released++;
    }
  );
  return { st, l };
}

test("Kamera-Vergabe: ohne Fahrzeug laeuft jeder Zugriff, am Ende wird einmal freigegeben", async () => {
  const { st, l } = lease();
  assert.equal(await l.use(async () => "bild"), "bild");
  l.check();
  assert.equal(l.lost(), false);
  assert.equal(st.released, 0);
  l.release();
  l.release();
  assert.equal(st.released, 1);
  assert.equal(l.lost(), true);
});

test("Kamera-Vergabe: wartet ein Fahrzeug, gibt die Pipeline ab und macht kein Bild mehr", async () => {
  const { st, l } = lease();
  st.waiting = true;
  let ran = false;
  assert.equal(
    await l.use(async () => {
      ran = true;
      return "bild";
    }),
    null
  );
  assert.equal(ran, false);
  assert.equal(st.released, 1);
  // Auch wenn das Fahrzeug laengst durch ist: Dieser Lauf bekommt die Kamera nicht zurueck.
  st.waiting = false;
  assert.equal(l.lost(), true);
  assert.equal(await l.use(async () => "bild"), null);
  l.release();
  assert.equal(st.released, 1);
});

test("Kamera-Vergabe: ein laufendes Bild wird fertig, direkt danach bekommt das Fahrzeug die Kamera", async () => {
  const { st, l } = lease();
  let finish: (v: string) => void = () => undefined;
  const shot = l.use(() => new Promise<string>((r) => (finish = r)));
  st.waiting = true;
  // Der Takt prueft waehrend des Bildes: noch nicht abgeben.
  l.check();
  assert.equal(st.released, 0);
  finish("bild");
  assert.equal(await shot, "bild");
  assert.equal(st.released, 1);
  assert.equal(l.lost(), true);
});

test("Kamera-Vergabe: scheitert das Bild, bleibt die Kamera nicht belegt", async () => {
  const { st, l } = lease();
  await assert.rejects(
    l.use(async () => {
      throw new Error("Kamera antwortet nicht");
    })
  );
  st.waiting = true;
  l.check();
  assert.equal(st.released, 1);
});

test("Kamera-Vergabe: der Takt gibt zwischen zwei Bildern ab, sobald ein Fahrzeug wartet", () => {
  const { st, l } = lease();
  l.check();
  assert.equal(st.released, 0);
  st.waiting = true;
  l.check();
  l.check();
  assert.equal(st.released, 1);
});

test("Liste der laufenden Ereignisse: geht nur mit der Meldung, die genau ihren Stand traegt", () => {
  const r = new RunningReport<string>();
  // Nichts festgehalten: nichts mitsenden.
  assert.equal(r.take(true), null);

  // Festgehalten, Meldung leert die Warteschlange: mitsenden, aber nur einmal.
  r.enqueued();
  r.capture(["7:MOTION"]);
  assert.deepEqual(r.take(true), ["7:MOTION"]);
  assert.equal(r.take(true), null);

  // Die Meldung nimmt nur einen Teil mit (mehr als 100 Ereignisse): noch nicht.
  r.capture(["7:MOTION"]);
  assert.equal(r.take(false), null);
  // Die naechste leert die Warteschlange, nichts Neues kam dazu: jetzt.
  assert.deepEqual(r.take(true), ["7:MOTION"]);

  // Nach dem Festhalten kam ein neues Ereignis dazu (die Meldung davor war
  // noch unterwegs): Die Liste ist ueberholt und entfaellt.
  r.capture(["7:MOTION"]);
  r.enqueued();
  assert.equal(r.take(true), null);
  // Mit der naechsten Minute gibt es einen neuen Stand.
  r.capture(["7:MOTION", "8:PERSON"]);
  assert.deepEqual(r.take(true), ["7:MOTION", "8:PERSON"]);

  // Leere Liste ist eine Aussage (nichts laeuft), kein „nicht mitsenden“.
  r.capture([]);
  assert.deepEqual(r.take(true), []);
});
