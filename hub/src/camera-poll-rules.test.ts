import { test } from "node:test";
import assert from "node:assert/strict";
import { debounceEvents, newDebounceState, runningOf } from "./event-debounce.js";
import {
  CameraLease,
  RunningReport,
  START_MAX_AGE_MS,
  UnconfirmedStarts,
  aiAlarmState,
  clockDriftKey,
  endHoldFor,
  endsToRetry,
  snapshotJobFor,
  tidyOutbox,
  type QueuedEvent,
  type SnapshotGate,
} from "./camera-poll-rules.js";

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

test("KI-Alarm: abgeschaltete Fahrzeug-Erkennung heisst nicht aktiv, eine unbekannte Art bleibt ungemessen", () => {
  const on = { alarm_state: 1, support: 1 };
  assert.equal(aiAlarmState("VEHICLE", on, true), true);
  assert.equal(aiAlarmState("VEHICLE", { alarm_state: 0, support: 1 }, true), false);
  // Abgeschaltet: nicht aktiv, auch wenn die Kamera Alarm meldet oder die Art gar nicht kennt.
  assert.equal(aiAlarmState("VEHICLE", on, false), false);
  assert.equal(aiAlarmState("VEHICLE", undefined, false), false);
  // Die Einstellung betrifft nur Fahrzeuge.
  assert.equal(aiAlarmState("PERSON", on, false), true);
  // Kamera kennt die Art nicht: ungemessen.
  assert.equal(aiAlarmState("ANIMAL", undefined, true), null);
  assert.equal(aiAlarmState("ANIMAL", { alarm_state: 1, support: 0 }, true), null);
});

test("KI-Alarm: ein laufendes Fahrzeug-Ereignis endet, wenn die Erkennung abgeschaltet wird", () => {
  const st = newDebounceState();
  const hold = 6_000;
  const alarm = { alarm_state: 1, support: 1 };
  const measure = (now: number, vehicleDetection: boolean) => {
    const v = aiAlarmState("VEHICLE", alarm, vehicleDetection);
    return debounceEvents(st, v === null ? {} : { VEHICLE: v }, now, hold);
  };
  assert.deepEqual(measure(10_000, true), [{ type: "VEHICLE", phase: "start", at: 10_000 }]);
  assert.deepEqual(measure(12_000, true), []);
  // Erkennung abgeschaltet, die Kamera meldet weiter Alarm: Nach dem Nachlauf
  // endet das Ereignis mit seiner letzten aktiven Messung.
  assert.deepEqual(measure(14_000, false), []);
  assert.deepEqual(measure(20_000, false), [{ type: "VEHICLE", phase: "end", at: 12_000 }]);
  assert.deepEqual(runningOf(st), []);
});

// ---- Warteschlange der Meldungen an die Cloud ----

const T = Date.UTC(2026, 10, 25, 10, 0, 0);
/** Ereignis `ageS` Sekunden vor T. */
const queued = (cameraId: number, type: string, phase: "start" | "end", ageS: number): QueuedEvent => ({
  cameraId,
  type,
  phase,
  at: new Date(T - ageS * 1000).toISOString(),
});
const show = (q: QueuedEvent[]) => q.map((e) => `${e.phase}:${e.cameraId}:${e.type}@-${(T - Date.parse(e.at)) / 1000}`);
const tidy = (q: QueuedEvent[], max = 400) => tidyOutbox(q, T, START_MAX_AGE_MS, max);

test("Warteschlange: ein frischer Beginn bleibt, ein zu alter entfaellt", () => {
  const r = tidy([queued(7, "PERSON", "start", 31), queued(8, "PERSON", "start", 30), queued(9, "MOTION", "start", 2)]);
  assert.deepEqual(show(r.queue), ["start:8:PERSON@-30", "start:9:MOTION@-2"]);
  assert.equal(r.staleStarts, 1);
  assert.equal(r.staleEnds, 0);
});

test("Warteschlange: mit dem zu alten Beginn entfaellt das Ende desselben Ereignisses, sonst keines", () => {
  const r = tidy([
    queued(7, "PERSON", "end", 300), // Ende eines Ereignisses, dessen Beginn schon hinausging: bleibt
    queued(7, "PERSON", "start", 120), // zu alt
    queued(8, "PERSON", "end", 110), // andere Kamera: bleibt
    queued(7, "MOTION", "end", 105), // andere Art: bleibt
    queued(7, "PERSON", "end", 100), // gehoert zum zu alten Beginn: entfaellt
    queued(7, "PERSON", "start", 5), // frisch
    queued(7, "PERSON", "end", 1), // gehoert zum frischen Beginn: bleibt
  ]);
  assert.deepEqual(show(r.queue), [
    "end:7:PERSON@-300",
    "end:8:PERSON@-110",
    "end:7:MOTION@-105",
    "start:7:PERSON@-5",
    "end:7:PERSON@-1",
  ]);
  assert.equal(r.staleStarts, 1);
  assert.equal(r.staleEnds, 1);
});

test("Warteschlange: laeuft das Ereignis des zu alten Beginns noch, bleibt ein spaeteres Ende stehen", () => {
  // Erster Aufruf: nur der Beginn steht da, das Ereignis laeuft. Die Cloud
  // traegt es ueber die Liste der laufenden Ereignisse nach.
  const first = tidy([queued(7, "MOTION", "start", 45)]);
  assert.deepEqual(first.queue, []);
  // Spaeter kommt das Ende: Es muss hinaus, die Cloud kennt das Ereignis jetzt.
  const later = tidy([queued(7, "MOTION", "end", 3)]);
  assert.deepEqual(show(later.queue), ["end:7:MOTION@-3"]);
  assert.equal(later.staleEnds, 0);
});

test("Warteschlange: Enden werden nie wegen ihres Alters verworfen, ein unlesbarer Zeitpunkt bleibt stehen", () => {
  const broken = { cameraId: 7, type: "PERSON", phase: "start", at: "kaputt" };
  const r = tidy([queued(7, "PERSON", "end", 7200), broken]);
  assert.equal(r.queue.length, 2);
  assert.equal(r.staleStarts + r.staleEnds + r.cutStarts + r.cutEnds, 0);
});

test("Warteschlange: wie lange ein Beginn wartet, zaehlt auch, wenn die Uhr des Hubs zurueckgestellt wurde", () => {
  // Die Uhr des Hubs wurde um 10 min zurueckgestellt: Nach ihr liegen die
  // Ereignisse von eben in der Zukunft, ihr Alter ist negativ.
  const old = queued(7, "PERSON", "start", -300); // wartet seit 5 min
  const oldEnd = queued(7, "PERSON", "end", -310);
  const fresh = queued(8, "VEHICLE", "start", -598); // wartet seit 2 s
  const atLimit = queued(9, "MOTION", "start", -570); // wartet genau 30 s
  const waited = new Map<QueuedEvent, number>([
    [old, 300_000],
    [oldEnd, 290_000],
    [fresh, 2_000],
    [atLimit, 30_000],
  ]);
  const q = [old, oldEnd, fresh, atLimit];
  const r = tidyOutbox(q, T, START_MAX_AGE_MS, 400, { waitedMs: (e) => waited.get(e) ?? 0 });
  assert.deepEqual(r.queue, [fresh, atLimit]);
  assert.equal(r.staleStarts, 1);
  assert.equal(r.staleEnds, 1);
  // Nach der Wanduhr allein gaelten alle als frisch.
  assert.deepEqual(tidy(q).queue, q);

  // Die Wanduhr zaehlt weiter mit: Stand der Rechner still, ist die Wartezeit
  // kurz, der Beginn aber alt.
  const asleep = queued(7, "MOTION", "start", 45);
  assert.deepEqual(tidyOutbox([asleep], T, START_MAX_AGE_MS, 400, { waitedMs: () => 1_000 }).queue, []);
});

test("Warteschlange voll: je Kamera und Art bleibt das aelteste Ende, ueberzaehlige Enden gehen zuerst", () => {
  // Kamera 5: das Ereignis von vor der Stoerung endet (aeltestes Ende), danach
  // fuenf weitere Enden, deren Beginn nie ankam. Kamera 6 genauso mit zwei.
  const q = [
    queued(5, "PERSON", "end", 600),
    queued(6, "PERSON", "end", 590),
    queued(5, "PERSON", "end", 500),
    queued(5, "PERSON", "end", 400),
    queued(6, "PERSON", "end", 390),
    queued(5, "PERSON", "end", 300),
    queued(5, "PERSON", "end", 200),
    queued(5, "PERSON", "end", 100),
  ];
  const r = tidy(q, 5);
  assert.deepEqual(show(r.queue), [
    "end:5:PERSON@-600",
    "end:6:PERSON@-590",
    "end:5:PERSON@-300",
    "end:5:PERSON@-200",
    "end:5:PERSON@-100",
  ]);
  assert.equal(r.cutEnds, 3);
  assert.equal(r.cutStarts, 0);
});

test("Warteschlange voll: das Ende hinter einem wartenden Beginn bleibt, Beginne gehen erst nach den ueberzaehligen Enden", () => {
  const q = [
    queued(5, "PERSON", "end", 600), // aeltestes Ende: bleibt
    queued(5, "PERSON", "end", 500), // ueberzaehlig
    queued(5, "PERSON", "start", 20), // frisch, wartet
    queued(5, "PERSON", "end", 10), // schliesst den wartenden Beginn: bleibt
    queued(5, "PERSON", "end", 5), // ueberzaehlig
  ];
  const three = tidy(q, 3);
  assert.deepEqual(show(three.queue), ["end:5:PERSON@-600", "start:5:PERSON@-20", "end:5:PERSON@-10"]);
  assert.equal(three.cutEnds, 2);
  assert.equal(three.cutStarts, 0);
  // Noch enger: jetzt erst faellt der Beginn.
  const two = tidy(q, 2);
  assert.deepEqual(show(two.queue), ["end:5:PERSON@-600", "end:5:PERSON@-10"]);
  assert.equal(two.cutStarts, 1);
});

test("Warteschlange voll: das Ende zu einem Beginn aus einer gescheiterten Meldung bleibt hinter einem aelteren Ende stehen", () => {
  // Die Meldung [Ende von vorhin, neuer Beginn] lief ins Zeitlimit. Der Hub
  // legt das Ende zurueck und verwirft den Beginn; die Cloud kann beides
  // verarbeitet haben und fuehrt das neue Ereignis dann als offen.
  const failed = [queued(5, "MOTION", "end", 900), queued(5, "MOTION", "start", 800)];
  const unconfirmed = new UnconfirmedStarts();
  unconfirmed.failed(failed);
  const q = [
    ...endsToRetry(failed),
    queued(5, "MOTION", "end", 780), // Ende des Ereignisses, das die Cloud kennen kann
    queued(5, "MOTION", "end", 600), // spaetere Enden, deren Beginn nie hinausging
    queued(5, "MOTION", "end", 400),
    queued(5, "MOTION", "end", 200),
  ];
  const r = tidyOutbox(q, T, START_MAX_AGE_MS, 3, { unconfirmed });
  assert.deepEqual(show(r.queue), ["end:5:MOTION@-900", "end:5:MOTION@-780", "end:5:MOTION@-200"]);
  assert.equal(r.cutEnds, 2);
  // Ohne die Angabe zaehlt nur das erste Ende je Kamera und Art.
  assert.deepEqual(show(tidy(q, 3).queue), ["end:5:MOTION@-900", "end:5:MOTION@-400", "end:5:MOTION@-200"]);
});

test("Warteschlange voll: jeder Beginn aus einer gescheiterten Meldung haelt sein Ende, nicht nur der juengste", () => {
  // Zwei Meldungen nacheinander scheiterten, jede mit einem Beginn derselben
  // Kamera und Art. Welche davon die Cloud verarbeitet hat, weiss der Hub nicht.
  const unconfirmed = new UnconfirmedStarts();
  unconfirmed.failed([queued(5, "MOTION", "end", 900), queued(5, "MOTION", "start", 800)]);
  unconfirmed.failed([queued(5, "MOTION", "end", 900), queued(5, "MOTION", "end", 780), queued(5, "MOTION", "start", 700)]);
  // Andere Kamera: Sie stand nur in der Liste der laufenden Ereignisse.
  unconfirmed.failed([], [{ cameraId: 6, type: "PERSON", at: queued(6, "PERSON", "start", 750).at }]);
  const q = [
    queued(5, "MOTION", "end", 900),
    queued(6, "PERSON", "end", 850), // aelteres Ende der anderen Kamera: das erste, bleibt
    queued(5, "MOTION", "end", 780), // Ende zum Beginn bei -800
    queued(6, "PERSON", "end", 740), // Ende zum laufend gemeldeten Ereignis
    queued(5, "MOTION", "end", 650), // Ende zum Beginn bei -700
    queued(5, "MOTION", "end", 500),
    queued(6, "PERSON", "end", 450),
    queued(5, "MOTION", "end", 300),
  ];
  const r = tidyOutbox(q, T, START_MAX_AGE_MS, 5, { unconfirmed });
  assert.deepEqual(show(r.queue), [
    "end:5:MOTION@-900",
    "end:6:PERSON@-850",
    "end:5:MOTION@-780",
    "end:6:PERSON@-740",
    "end:5:MOTION@-650",
  ]);
  assert.equal(r.cutEnds, 3);
});

test("Beginne aus gescheiterten Meldungen: erledigt, sobald ein Ende ab ihrem Zeitpunkt angekommen ist", () => {
  const unconfirmed = new UnconfirmedStarts();
  const end = (ageS: number) => queued(5, "MOTION", "end", ageS);
  // Nichts gemerkt: Kein Ende zaehlt.
  assert.equal(unconfirmed.upTo(end(100)), 0);
  // Ein Ende in einer gescheiterten Meldung ist kein Beginn.
  unconfirmed.failed([end(900)]);
  assert.equal(unconfirmed.upTo(end(100)), 0);

  unconfirmed.failed([queued(5, "MOTION", "start", 800), queued(5, "MOTION", "start", 700)]);
  // Dieselbe Meldung noch einmal und ein unlesbarer Zeitpunkt aendern nichts.
  unconfirmed.failed([queued(5, "MOTION", "start", 800), { cameraId: 5, type: "MOTION", phase: "start", at: "kaputt" }]);
  assert.equal(unconfirmed.upTo(end(900)), 0); // Ende von vor beiden Beginnen
  assert.equal(unconfirmed.upTo(end(800)), 1); // genau am Beginn (eine einzige aktive Messung)
  assert.equal(unconfirmed.upTo(end(650)), 2);
  // Andere Kamera und andere Art bleiben unberuehrt.
  assert.equal(unconfirmed.upTo(queued(6, "MOTION", "end", 650)), 0);
  assert.equal(unconfirmed.upTo(queued(5, "PERSON", "end", 650)), 0);

  // Ein angekommenes Ende von vorher erledigt nichts, ein Beginn auch nicht.
  unconfirmed.delivered([end(900), queued(5, "MOTION", "start", 600), { cameraId: 5, type: "MOTION", phase: "end", at: "kaputt" }]);
  assert.equal(unconfirmed.upTo(end(650)), 2);
  // Das Ende des ersten Ereignisses ist angekommen: Der zweite Beginn bleibt gemerkt.
  unconfirmed.delivered([end(780)]);
  assert.equal(unconfirmed.upTo(end(650)), 1);
  unconfirmed.delivered([end(650)]);
  assert.equal(unconfirmed.upTo(end(100)), 0);
  // Ein Ende genau am Beginn erledigt ihn ebenfalls.
  unconfirmed.failed([queued(5, "MOTION", "start", 50)]);
  unconfirmed.delivered([end(50)]);
  assert.equal(unconfirmed.upTo(end(10)), 0);
});

test("Warteschlange: unter der Obergrenze bleibt alles in seiner Reihenfolge", () => {
  const q = [queued(5, "PERSON", "end", 50), queued(6, "VEHICLE", "start", 3), queued(5, "PERSON", "start", 2), queued(6, "VEHICLE", "end", 1)];
  const r = tidy(q);
  assert.deepEqual(r.queue, q);
});
