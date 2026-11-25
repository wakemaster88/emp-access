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
  configRefreshPlan,
  endHoldFor,
  endsToRetry,
  failStreakAfter,
  pollDue,
  pollOrder,
  relocateAtStart,
  relocateByLoginAllowed,
  relocateIntervalMs,
  snapshotJobFor,
  tidyOutbox,
  type ConfigRefreshState,
  type PollGate,
  type QueuedEvent,
  type SnapshotGate,
} from "./camera-poll-rules.js";
import { assessTrends, linkStats, newHealthStore, recordLink } from "./agent/early-warning.js";

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

const cfg = (o: Partial<ConfigRefreshState> = {}): ConfigRefreshState => ({
  now: 1_000_000,
  loadedAt: 990_000,
  failedAt: 0,
  running: false,
  haveCameras: true,
  refreshMs: 60_000,
  retryMs: 15_000,
  ...o,
});

test("Kamera-Liste: frisch geladen wird nichts nachgeladen", () => {
  assert.equal(configRefreshPlan(cfg()), "none");
});

test("Kamera-Liste: faellig und Kameras bekannt, dann im Hintergrund (die Abfrage wartet nicht auf die Cloud)", () => {
  assert.equal(configRefreshPlan(cfg({ loadedAt: 930_000 })), "background");
  // Als veraltet markiert (z. B. neue Parkkamera): sofort, aber ohne Warten.
  assert.equal(configRefreshPlan(cfg({ loadedAt: 0 })), "background");
});

test("Kamera-Liste: ohne bekannte Kamera wartet der Poll auf den Abruf", () => {
  assert.equal(configRefreshPlan(cfg({ loadedAt: 0, haveCameras: false })), "wait");
  // Ein anderer Aufrufer (Auftrag aus der Cloud) laedt schon: mitwarten.
  assert.equal(configRefreshPlan(cfg({ loadedAt: 0, haveCameras: false, running: true })), "wait");
});

test("Kamera-Liste: nach einem Fehlschlag erst nach der Wartezeit wieder, auch beim Start ohne Cloud", () => {
  assert.equal(configRefreshPlan(cfg({ loadedAt: 900_000, failedAt: 990_000 })), "none");
  assert.equal(configRefreshPlan(cfg({ loadedAt: 900_000, failedAt: 985_000 })), "background");
  assert.equal(configRefreshPlan(cfg({ loadedAt: 0, haveCameras: false, failedAt: 990_000 })), "none");
  assert.equal(configRefreshPlan(cfg({ loadedAt: 0, haveCameras: false, failedAt: 985_000 })), "wait");
});

test("Kamera-Liste: laeuft ein Abruf schon, startet kein zweiter", () => {
  assert.equal(configRefreshPlan(cfg({ loadedAt: 900_000, running: true })), "none");
});

const poll = (o: Partial<PollGate> = {}): PollGate => ({
  now: 1_000_000,
  lastStartAt: 998_000,
  inFlight: false,
  baseMs: 2_000,
  ...o,
});

test("Abfrage: erreichbare Kamera in jedem Takt, auch wenn der Timer etwas frueh kommt", () => {
  assert.equal(pollDue(poll()), true);
  assert.equal(pollDue(poll({ lastStartAt: 998_040 })), true);
  assert.equal(pollDue(poll({ lastStartAt: 0 })), true);
});

test("Abfrage: eine haengende Kamera wird uebersprungen, bis ihre Antwort da ist", () => {
  assert.equal(pollDue(poll({ inFlight: true, lastStartAt: 990_000 })), false);
  // Antwort kam spaet (z. B. nach 7 s): im naechsten Takt wieder dabei.
  assert.equal(pollDue(poll({ lastStartAt: 993_000 })), true);
});

test("Abfrage: nur lange Fehlversuche zaehlen fuer die Reihenfolge, ein schneller setzt die Kamera wieder nach vorn", () => {
  // Dreimal in Folge ins Zeitlimit (8 s).
  let streak = 0;
  for (let i = 0; i < 3; i++) streak = failStreakAfter(streak, 8_000, 4_000);
  assert.equal(streak, 3);
  // Die Kamera faehrt hoch und lehnt sofort ab (HTTP 503 nach 40 ms).
  streak = failStreakAfter(streak, 40, 4_000);
  assert.equal(streak, 0);
  // Schnell scheiternd bleibt sie vorn, egal wie lange der Ausfall dauert.
  for (let i = 0; i < 500; i++) streak = failStreakAfter(streak, 40, 4_000);
  assert.equal(streak, 0);
  // Genau an der Schwelle zaehlt der Versuch als lang.
  assert.equal(failStreakAfter(0, 4_000, 4_000), 1);
  assert.equal(failStreakAfter(0, 3_999, 4_000), 0);
});

test("Abfrage: Kameras ohne langen Fehlversuch kommen im Takt zuerst an die Reihe", () => {
  const cams = [
    { id: 1, failStreak: 4 },
    { id: 2, failStreak: 0 },
    { id: 3, failStreak: 1 },
    { id: 4, failStreak: 0 },
  ];
  const ordered = pollOrder(cams);
  assert.deepEqual(ordered.map((c) => c.id), [2, 4, 1, 3]);
  // Dieselben Kameras, keine verloren und keine doppelt.
  assert.deepEqual([...ordered].sort((a, b) => a.id - b.id), cams);
  assert.equal(ordered[0], cams[1]);
  // Ohne haengende Kamera bleibt die Reihenfolge der Liste.
  const fine = [{ id: 7, failStreak: 0 }, { id: 5, failStreak: 0 }];
  assert.deepEqual(pollOrder(fine), fine);
  assert.deepEqual(pollOrder([]), []);
});

/**
 * Eine Stunde Abfragen im 2-Sekunden-Takt mit einem Ausfall in der Mitte, so
 * wie pollCameras und pollOne sie fahren (faellig nach pollDue). Die Abfrage
 * beginnt `startMs` nach dem Takt (negativ: Ihr Ende faellt knapp vor einen
 * Takt statt knapp dahinter). Liefert, was die Frueherkennung daraus liest,
 * und wie lange nach dem Ende des Ausfalls die erste Abfrage begann.
 */
function hourWithOutage(
  outageMin: number,
  failTookMs: number,
  startMs = 1
): { fails: number; warned: boolean; backMs: number } {
  const store = newHealthStore();
  const t0 = Date.UTC(2026, 10, 24, 12);
  const end = t0 + 3_600_000;
  const downFrom = t0 + 30 * 60_000;
  const downTo = downFrom + Math.round(outageMin * 60_000);
  let lastStartAt = 0;
  let backMs = -1;
  let running: { doneAt: number; ok: boolean } | null = null;
  for (let now = t0; now < end; now += 2_000) {
    if (running && running.doneAt <= now) {
      recordLink(store, "cam:1", "Kamera 1", "camera", running.ok, running.doneAt);
      running = null;
    }
    if (!pollDue({ now, lastStartAt, inFlight: running !== null, baseMs: 2_000 })) continue;
    lastStartAt = now;
    const ok = now < downFrom || now >= downTo;
    if (ok && now >= downTo && backMs < 0) backMs = now - downTo;
    running = { doneAt: now + startMs + (ok ? 50 : failTookMs), ok };
  }
  return {
    fails: linkStats("cam:1", store.links["cam:1"], end).fail1h,
    warned: assessTrends(store, end).some((f) => f.key === "trend:link:cam:1"),
    backMs,
  };
}

/** Zaehlung der Frueherkennung fuer einen Ausfall, ohne die Zeit bis zur ersten Abfrage. */
function counted(outageMin: number, failTookMs: number, startMs = 1): { fails: number; warned: boolean } {
  const { fails, warned } = hourWithOutage(outageMin, failTookMs, startMs);
  return { fails, warned };
}

/** Laengste Zeit vom Ende eines Ausfalls bis zur ersten Abfrage, ueber alle Lagen des Endes zum Takt (100-ms-Schritte). */
function worstBackMs(failTookMs: number, startMs = 1): number {
  let worst = 0;
  for (let shiftMs = 0; shiftMs < 20_000; shiftMs += 100) {
    worst = Math.max(worst, hourWithOutage(10 + shiftMs / 60_000, failTookMs, startMs).backMs);
  }
  return worst;
}

test("Frueherkennung: lehnt eine Kamera minutenlang sofort ab, zaehlt jeder Takt und die Vorwarnung kommt", () => {
  // 3 min in einer Stunde, alle 2 s gefragt: 90 Fehlversuche, 5 %.
  assert.deepEqual(counted(3, 50), { fails: 90, warned: true });
  assert.deepEqual(counted(10, 50), { fails: 300, warned: true });
});

test("Frueherkennung: eine haengende Kamera zaehlt je Abfrage, also alle 8 bis 10 s", () => {
  // Jede Abfrage wartet 8 s auf das Zeitlimit. Laeuft es knapp nach einem
  // Takt ab, ist die Kamera alle 10 s dran: 6 Fehlversuche je Minute.
  assert.deepEqual(counted(3, 8_000), { fails: 18, warned: false });
  assert.deepEqual(counted(20, 8_000), { fails: 120, warned: true });
});

test("Frueherkennung: scheitert eine Kamera erst nach Sekunden, zaehlt jede Abfrage im Takt nach ihrem Ende", () => {
  // HTTP-Fehler nach 5 s: alle 6 s gefragt, 10 Fehlversuche je Minute.
  assert.deepEqual(counted(10, 5_000), { fails: 100, warned: true });
  // Nach 7 s: alle 8 s.
  assert.deepEqual(counted(12, 7_000), { fails: 90, warned: true });
  // Haengend, und das Zeitlimit laeuft knapp vor einem Takt ab: ebenfalls alle 8 s.
  assert.deepEqual(counted(12, 8_000, -1), { fails: 90, warned: true });
});

test("Abfrage: nach der Rueckkehr einer Kamera kommt die erste Abfrage im Takt nach dem Ende ihres letzten Fehlversuchs", () => {
  // Dann kann schon ein Fahrzeug vor dem Tor stehen: Mehr als die Dauer
  // eines Fehlversuchs plus einen Takt wartet es nie, egal wie lange die
  // Kamera weg war.
  assert.ok(worstBackMs(50) < 2_000); // lehnt sofort ab
  assert.ok(worstBackMs(3_000) <= 4_000);
  assert.ok(worstBackMs(5_000) <= 6_000);
  assert.ok(worstBackMs(7_000) <= 8_000);
  assert.ok(worstBackMs(8_000) < 10_000); // Zeitlimit knapp nach einem Takt
  assert.ok(worstBackMs(8_000, -1) <= 8_000); // Zeitlimit knapp vor einem Takt
  // Auch nach Stunden ohne Antwort.
  assert.ok(hourWithOutage(29, 8_000).backMs < 10_000);
});

test("Abfrage: ein langsamer eingestellter Takt wird nie unterschritten", () => {
  // Die Abfrage begann erst 5 s vor diesem Takt (sie wartete auf einen Platz).
  assert.equal(pollDue(poll({ baseMs: 15_000, lastStartAt: 995_000 })), false);
  assert.equal(pollDue(poll({ baseMs: 15_000, lastStartAt: 985_000 })), true);
});

test("Suche nach neuer Adresse: erst jede Minute, nach einer Stunde nur noch alle 15 min", () => {
  assert.equal(relocateIntervalMs(0), 60_000);
  assert.equal(relocateIntervalMs(9 * 60_000), 60_000);
  assert.equal(relocateIntervalMs(10 * 60_000), 5 * 60_000);
  assert.equal(relocateIntervalMs(59 * 60_000), 5 * 60_000);
  assert.equal(relocateIntervalMs(10 * 24 * 3_600_000), 15 * 60_000);
});

test("Suche per Anmeldung bei anderen Geraeten: nur in der ersten Stunde", () => {
  assert.equal(relocateByLoginAllowed(5 * 60_000), true);
  assert.equal(relocateByLoginAllowed(60 * 60_000), false);
});

test("Suche nach neuer Adresse nach einem Neustart: ein gemerkter Ausfall laeuft in seiner Stufe weiter, die naechste Suche kommt im Raster ab Ausfallbeginn", () => {
  const now = Date.parse("2026-11-25T18:00:00Z");
  const min = 60_000;
  // Die Kamera antwortete zuletzt (oder ist neu in der Liste): Faellt sie aus, beginnt die Suche sofort.
  assert.deepEqual(relocateAtStart(null, now), { downSince: null, lastRelocateAt: 0 });
  // Seit 3 h 10 min weg: Es bleibt bei alle 15 min ohne Anmeldung. Der letzte
  // Punkt des Rasters liegt 10 min zurueck, die naechste Suche kommt in 5 min.
  const since = now - 190 * min;
  assert.deepEqual(relocateAtStart(since, now), { downSince: since, lastRelocateAt: now - 10 * min });
  assert.equal(relocateIntervalMs(now - since), 15 * min);
  assert.equal(relocateByLoginAllowed(now - since), false);
  // Startet der Hub 4 min spaeter noch einmal, bleibt es bei derselben naechsten Suche.
  assert.equal(relocateAtStart(since, now + 4 * min).lastRelocateAt, now - 10 * min);
  // Genau auf einem Punkt des Rasters gilt dieser als der letzte.
  assert.equal(relocateAtStart(now - 180 * min, now).lastRelocateAt, now);
  // Seit 27 min weg: alle 5 min, die naechste Suche in 3 min.
  assert.equal(relocateAtStart(now - 27 * min, now).lastRelocateAt, now - 2 * min);
  // Seit 5 min 20 s weg: weiter jede Minute, auch per Anmeldung; die naechste Suche in 40 s.
  const short = now - 5 * min - 20_000;
  assert.deepEqual(relocateAtStart(short, now), { downSince: short, lastRelocateAt: now - 20_000 });
  assert.equal(relocateByLoginAllowed(now - short), true);
  // Gemerkte Zeit knapp voraus (Uhr nachgestellt): Der Ausfall beginnt jetzt, nicht in der Zukunft.
  assert.deepEqual(relocateAtStart(now + 30_000, now), { downSince: now, lastRelocateAt: now });
});

interface DeadCameraSearches {
  /** Suchen unter neuer Adresse je Stunde. */
  searches: number[];
  /** Davon mit Anmeldung bei anderen Geraeten. */
  byLogin: number[];
  /** Laengste Pause zwischen zwei Suchen nach der ersten Stunde, auf ganze Minuten aufgerundet. */
  longestPauseMin: number;
  /** Die meisten Suchen in 60 Minuten nach der ersten Stunde. */
  mostIn60Min: number;
}

/**
 * Eine Kamera, die dauerhaft nicht antwortet (jede Abfrage laeuft ins
 * Zeitlimit von 8 s), ueber sechs Stunden; der Hub startet dazwischen neu
 * (Stunden als Kommazahl). Virtuelle Uhr, Takt 2 s, die echten Regeln.
 */
function deadCameraSearches(restartsAtHour: number[]): DeadCameraSearches {
  const base = 2_000;
  const hour = 3_600_000;
  const end = 6 * hour;
  const searches: number[] = [];
  const byLogin: number[] = [];
  /** Was ueber den Neustart gemerkt ist (Ausfallbeginn). */
  let remembered: number | null = null;
  const start = (now: number) => ({ lastStartAt: 0, inFlight: false, doneAt: -1, ...relocateAtStart(remembered, now) });
  let cam = start(0);
  const restarts = restartsAtHour.map((h) => Math.round(h * hour));
  for (let t = base; t <= end; t += base) {
    if (restarts.length > 0 && t >= restarts[0]) {
      restarts.shift();
      cam = start(t);
    }
    if (cam.inFlight && t >= cam.doneAt) {
      const doneAt = cam.doneAt;
      cam.inFlight = false;
      if (cam.downSince === null) {
        cam.downSince = doneAt;
        remembered = doneAt;
      }
      const downFor = doneAt - cam.downSince;
      if (doneAt - cam.lastRelocateAt >= relocateIntervalMs(downFor)) {
        cam.lastRelocateAt = doneAt;
        searches.push(doneAt);
        if (relocateByLoginAllowed(downFor)) byLogin.push(doneAt);
      }
    }
    if (pollDue({ now: t, lastStartAt: cam.lastStartAt, inFlight: cam.inFlight, baseMs: base })) {
      cam.inFlight = true;
      cam.lastStartAt = t;
      // Die Abfrage beginnt wenige Millisekunden nach dem Takt.
      cam.doneAt = t + 3 + 8_000;
    }
  }
  const perHour = (times: number[]) =>
    Array.from({ length: 6 }, (_, h) => times.filter((x) => x >= h * hour && x < (h + 1) * hour).length);
  // Auch die Zeit von der letzten Suche bis zum Ende zaehlt als Pause.
  let longestPause = end - searches[searches.length - 1];
  for (let i = 1; i < searches.length; i++) {
    if (searches[i] >= hour) longestPause = Math.max(longestPause, searches[i] - searches[i - 1]);
  }
  const late = searches.filter((x) => x >= hour);
  return {
    searches: perHour(searches),
    byLogin: perHour(byLogin),
    longestPauseMin: Math.ceil(longestPause / 60_000),
    mostIn60Min: Math.max(0, ...late.map((x) => late.filter((y) => y >= x && y < x + hour).length)),
  };
}

/** Neustarts im festen Abstand (Minuten) zwischen zwei Zeitpunkten (Stunden). */
function restartsEvery(everyMin: number, fromHour: number, toHour: number): number[] {
  const out: number[] = [];
  for (let m = fromHour * 60; m <= toHour * 60; m += everyMin) out.push(m / 60);
  return out;
}

test("Suche nach neuer Adresse: eine stumme Kamera wird nach der ersten Stunde viermal je Stunde gesucht, mit Neustarts hoechstens fuenfmal", () => {
  // Die erste Stunde des Ausfalls reicht bis kurz nach der vollen Stunde: daher die eine Anmeldung in Stunde 2.
  assert.deepEqual(deadCameraSearches([]), {
    searches: [19, 4, 4, 4, 4, 4],
    byLogin: [19, 1, 0, 0, 0, 0],
    longestPauseMin: 15,
    mostIn60Min: 4,
  });
  // Zwei Updates am Nachmittag: Die Suche laeuft durch.
  assert.deepEqual(deadCameraSearches([2 + 20 / 60, 4 + 50 / 60]), {
    searches: [19, 4, 4, 4, 4, 4],
    byLogin: [19, 1, 0, 0, 0, 0],
    longestPauseMin: 16,
    mostIn60Min: 4,
  });
  // Vier Updates, das erste schon in der ersten halben Stunde. Nach einem
  // Start kommt die naechste Suche am naechsten Punkt des Rasters; zur letzten
  // davor koennen einmal bis zu zwei Abstaende liegen, nie mehr.
  const four = deadCameraSearches([0.5, 2.1, 2.6, 3.3]);
  assert.deepEqual(four.searches, [19, 4, 3, 4, 4, 4]);
  assert.deepEqual(four.byLogin, [19, 0, 0, 0, 0, 0]);
  assert.ok(four.longestPauseMin < 30);
  assert.ok(four.mostIn60Min <= 5);
});

test("Suche nach neuer Adresse: startet der Hub oefter neu, als die Stufe lang ist, laeuft die Suche weiter und wird nicht haeufiger", () => {
  // Ein Tag mit vielen Updates: zwei Stunden lang alle 10 min ein Neustart,
  // ebenso alle 5 min (so oft prueft der Hub auf Updates).
  for (const everyMin of [10, 5]) {
    const serie = deadCameraSearches(restartsEvery(everyMin, 1, 3));
    assert.deepEqual(serie.searches, [19, 3, 4, 4, 4, 4]);
    assert.deepEqual(serie.byLogin, [19, 0, 0, 0, 0, 0]);
    // Der erste Neustart faellt in den Wechsel der Stufe: Von der letzten
    // Suche im 5-Minuten-Abstand bis zum ersten Punkt des 15-Minuten-Rasters
    // vergehen einmal gut 20 min, danach sind es 15.
    assert.ok(serie.longestPauseMin <= 21);
    assert.equal(serie.mostIn60Min, 4);
  }
  // Alle 14 min, drei Stunden lang: knapp unter dem Abstand der Stufe.
  const fast = deadCameraSearches(restartsEvery(14, 1, 4));
  assert.deepEqual(fast.searches, [19, 4, 4, 4, 4, 4]);
  assert.equal(fast.longestPauseMin, 16);
  assert.ok(fast.mostIn60Min <= 5);
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

  // Die Wanduhr zaehlt weiter mit: Ruhte der Rechner und zaehlte die andere
  // Uhr dabei nicht, ist die Wartezeit kurz, der Beginn aber alt.
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

test("Warteschlange voll: allein wegen der Beginne aus gescheiterten Meldungen bleiben hoechstens so viele Enden wie erlaubt, die aeltesten", () => {
  // Vier Meldungen nacheinander scheiterten, jede mit einem Beginn derselben Kamera und Art.
  const unconfirmed = new UnconfirmedStarts();
  for (const ageS of [800, 700, 600, 500]) unconfirmed.failed([queued(5, "MOTION", "start", ageS)]);
  const q = [
    queued(5, "MOTION", "end", 780), // erstes Ende der Kamera und Art: bleibt ohnehin und zaehlt nicht mit
    queued(5, "MOTION", "end", 680), // Ende zum Beginn bei -700
    queued(5, "MOTION", "end", 580), // Ende zum Beginn bei -600
    queued(5, "MOTION", "end", 480), // Ende zum Beginn bei -500: das dritte, ueber der Zahl
    queued(5, "MOTION", "end", 300), // spaetere Enden, deren Beginn nie hinausging
    queued(5, "MOTION", "end", 200),
  ];
  const r = tidyOutbox(q, T, START_MAX_AGE_MS, 4, { unconfirmed, unconfirmedMax: 2 });
  assert.deepEqual(show(r.queue), ["end:5:MOTION@-780", "end:5:MOTION@-680", "end:5:MOTION@-580", "end:5:MOTION@-200"]);
  assert.equal(r.cutEnds, 2);
  // Ohne die Zahl bleibt das Ende zu jedem der Beginne.
  assert.deepEqual(show(tidyOutbox(q, T, START_MAX_AGE_MS, 4, { unconfirmed }).queue), [
    "end:5:MOTION@-780",
    "end:5:MOTION@-680",
    "end:5:MOTION@-580",
    "end:5:MOTION@-480",
  ]);
  // Ein einziger solcher Beginn: Sein Ende ist hier das erste der Kamera und
  // Art, dahinter haelt er kein weiteres fest.
  const single = new UnconfirmedStarts();
  single.failed([queued(5, "MOTION", "start", 800)]);
  assert.deepEqual(show(tidyOutbox(q, T, START_MAX_AGE_MS, 2, { unconfirmed: single, unconfirmedMax: 2 }).queue), [
    "end:5:MOTION@-780",
    "end:5:MOTION@-200",
  ]);
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
