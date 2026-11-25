import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPIRING_HUB_TASK_TYPES,
  SWITCH_COMMAND_MAX_AGE_MS,
  checkHubTaskPayload,
  deviceTaskSetAt,
  doorHoldUntilError,
  expiredSwitchCommandsWhere,
  hubTaskActor,
  piOpenTaskExpired,
  piOpenTaskNeedsFetchMark,
  piReportClearsOpenTask,
  piReportHoldsOpenTask,
  piReportWrite,
  switchCommandCutoff,
  withActor,
} from "./hub-task-rules";
import { DOOR_HOLD_MAX_MINUTES } from "./door-hold";

const now = new Date("2026-11-24T12:00:00.000Z");

test("Verfallsgrenze liegt eine Minute vor jetzt", () => {
  assert.equal(switchCommandCutoff(now).getTime(), now.getTime() - SWITCH_COMMAND_MAX_AGE_MS);
});

test("Zustaende und lange Laeufe verfallen nicht", () => {
  const expiring = new Set<string>(EXPIRING_HUB_TASK_TYPES);
  for (const type of [
    "DOORBIRD_HOLD",
    "NETWORK_SCAN",
    "SWITCH_SYNC",
    "FACE_ENROLL",
    "FACE_ANALYZE",
    "SERVICE_RESTART",
    "HUB_LOG",
    "SYSTEM_CHECK",
    "SOUNDWEB_SYNC",
    "AGENT_TOOL",
    "CAMERA_IR",
    "MOWER_ACTION",
  ]) {
    assert.equal(expiring.has(type), false, type);
  }
  for (const type of ["DOORBIRD_OPEN", "CAMERA_SIREN", "HUE_SET", "SHELLY_SWITCH", "SOUNDWEB_SET", "SCAN_SNAPSHOT"]) {
    assert.equal(expiring.has(type), true, type);
  }
});

test("Abholung: nur Einschalt-Befehle von Licht, Relais und Sirene verfallen", () => {
  const where = expiredSwitchCommandsWhere(7, now);
  assert.equal(where.accountId, 7);
  assert.equal(where.status, "PENDING");
  assert.equal(where.createdAt.lt.getTime(), now.getTime() - SWITCH_COMMAND_MAX_AGE_MS);

  // Nachbildung des Filters fuer einen Auftrag (Prisma-JSON-Pfad ["on"]).
  const matches = (type: string, payload: Record<string, unknown>) =>
    where.OR.some((cond) => {
      const typeOk = typeof cond.type === "string" ? cond.type === type : cond.type.in.includes(type as never);
      if (!typeOk) return false;
      const filter = "payload" in cond ? cond.payload : undefined;
      if (!filter) return true;
      return payload[filter.path[0]] === filter.equals;
    });

  for (const type of ["DOORBIRD_OPEN", "CAMERA_PTZ", "CAMERA_SCENE", "SOUNDWEB_SET", "SCAN_SNAPSHOT"]) {
    assert.equal(matches(type, {}), true, type);
  }
  for (const type of ["HUE_SET", "CAMERA_SPOTLIGHT", "CAMERA_SIREN"]) {
    assert.equal(matches(type, { on: true }), true, type);
    assert.equal(matches(type, { on: false }), false, type);
    // Hub liest hier nur on === true als Ein; Text ist dort Aus.
    assert.equal(matches(type, { on: "true" }), false, type);
  }
  assert.equal(matches("SHELLY_SWITCH", { on: true }), true);
  assert.equal(matches("SHELLY_SWITCH", { on: "true" }), true);
  assert.equal(matches("SHELLY_SWITCH", { on: "on" }), true);
  assert.equal(matches("SHELLY_SWITCH", { on: false }), false);
  assert.equal(matches("SHELLY_SWITCH", { on: "off" }), false);
  // Umschalten ohne on bleibt wie bisher.
  assert.equal(matches("SHELLY_SWITCH", {}), false);
  for (const type of ["DOORBIRD_HOLD", "CAMERA_IR", "NETWORK_SCAN", "AGENT_TOOL"]) {
    assert.equal(matches(type, { on: true }), false, type);
  }
});

test("Einmal-Oeffnen am Pi verfaellt nach 60 s, nur mit bekanntem Zeitpunkt", () => {
  const old = new Date(now.getTime() - 61_000);
  const fresh = new Date(now.getTime() - 30_000);
  assert.equal(piOpenTaskExpired(1, old, now), true);
  assert.equal(piOpenTaskExpired(1, fresh, now), false);
  assert.equal(piOpenTaskExpired(1, null, now), false);
  assert.equal(piOpenTaskExpired(1, undefined, now), false);
  // NOT-AUF und Deaktiviert sind Zustaende.
  assert.equal(piOpenTaskExpired(2, old, now), false);
  assert.equal(piOpenTaskExpired(3, old, now), false);
  assert.equal(piOpenTaskExpired(0, old, now), false);
});

test("taskSetAt wird bei 0 geloescht, sonst gesetzt", () => {
  assert.equal(deviceTaskSetAt(0, now), null);
  assert.equal(deviceTaskSetAt(1, now), now);
  assert.equal(deviceTaskSetAt(3, now), now);
});

test("Benutzerangabe aus der Sitzung", () => {
  assert.deepEqual(hubTaskActor({ id: "7", name: "Kasse" }), { adminId: 7, name: "Kasse" });
  assert.deepEqual(hubTaskActor({ id: "x", name: null }), { adminId: null, name: null });
  assert.deepEqual(hubTaskActor(undefined), { adminId: null, name: null });
});

test("by wird nur an Objekt- oder leere Payloads gehaengt", () => {
  const by = { adminId: 1, name: "A" };
  assert.deepEqual(withActor(undefined, by), { by });
  assert.deepEqual(withActor({ cameraId: 3 }, by), { cameraId: 3, by });
  assert.deepEqual(withActor([1, 2], by), [1, 2]);
  assert.equal(withActor("x", by), "x");
});

test("Payloads der Oberflaeche bestehen die Pruefung", () => {
  const snap = checkHubTaskPayload("CAMERA_SNAPSHOT", { cameraId: 4 });
  assert.deepEqual(snap, { ok: true, payload: { cameraId: 4 }, cameraId: 4 });
  assert.equal(checkHubTaskPayload("DOORBIRD_OPEN", { cameraId: 5 }).ok, true);
  assert.equal(checkHubTaskPayload("DOORBIRD_OPEN", { cameraId: 5, relay: 1, extra: "x" }).ok, true);
  assert.equal(checkHubTaskPayload("SERVICE_RESTART", { service: "tracker" }).ok, true);
  assert.equal(checkHubTaskPayload("SERVICE_RESTART", { service: "hub" }).ok, true);
  assert.equal(checkHubTaskPayload("HUB_LOG", { file: "hub", lines: 500, grep: undefined }).ok, true);
  assert.equal(checkHubTaskPayload("HUB_LOG", { file: "error", lines: 200, grep: "fehler", at: now.toISOString() }).ok, true);
  assert.equal(checkHubTaskPayload("HUB_LOG", { file: "improve", lines: 1500, before: 1024 }).ok, true);
  assert.equal(checkHubTaskPayload("HUB_LOG", { file: "hub", lines: 200, after: 0 }).ok, true);
});

test("Ungueltige Payloads werden abgelehnt", () => {
  assert.equal(checkHubTaskPayload("CAMERA_SNAPSHOT", {}).ok, false);
  assert.equal(checkHubTaskPayload("CAMERA_SNAPSHOT", undefined).ok, false);
  assert.equal(checkHubTaskPayload("DOORBIRD_OPEN", { cameraId: "abc" }).ok, false);
  assert.equal(checkHubTaskPayload("DOORBIRD_OPEN", { cameraId: 2, relay: 0 }).ok, false);
  assert.equal(checkHubTaskPayload("SERVICE_RESTART", { service: "shell" }).ok, false);
  assert.equal(checkHubTaskPayload("HUB_LOG", { file: "../etc" }).ok, false);
  // Kamera-Typ ohne eigenes Schema: cameraId bleibt Pflicht.
  const ptz = checkHubTaskPayload("CAMERA_PTZ", { cameraId: "9", op: "Left" });
  assert.deepEqual(ptz, { ok: true, payload: { cameraId: "9", op: "Left" }, cameraId: 9 });
  assert.equal(checkHubTaskPayload("CAMERA_SIREN", { on: true }).ok, false);
});

test("Typen ohne Schema bleiben unveraendert", () => {
  assert.deepEqual(checkHubTaskPayload("NETWORK_SCAN", undefined), { ok: true, payload: undefined, cameraId: null });
  assert.deepEqual(checkHubTaskPayload("PING", { host: "h" }), { ok: true, payload: { host: "h" }, cameraId: null });
});

test("Tor offen halten: until hoechstens so weit wie die Offenhalte-Route", () => {
  const inMinutes = (m: number) => new Date(now.getTime() + m * 60_000).toISOString();
  assert.equal(doorHoldUntilError({ cameraId: 1, until: inMinutes(15) }, now), null);
  assert.equal(doorHoldUntilError({ cameraId: 1, until: inMinutes(DOOR_HOLD_MAX_MINUTES) }, now), null);
  assert.match(doorHoldUntilError({ cameraId: 1, until: inMinutes(DOOR_HOLD_MAX_MINUTES + 1) }, now) ?? "", /höchstens/);
  assert.match(doorHoldUntilError({ cameraId: 1, until: inMinutes(3 * 24 * 60) }, now) ?? "", /höchstens/);
  assert.equal(doorHoldUntilError({ cameraId: 1, until: "morgen" }, now), "Ungültige Auftragsdaten (until)");
  // Beenden (wie die Route DELETE es schickt) und Zeitpunkte in der Vergangenheit bleiben erlaubt.
  assert.equal(doorHoldUntilError({ cameraId: 1, until: null }, now), null);
  assert.equal(doorHoldUntilError({ cameraId: 1 }, now), null);
  assert.equal(doorHoldUntilError({ cameraId: 1, until: "" }, now), null);
  assert.equal(doorHoldUntilError({ cameraId: 1, until: inMinutes(-5) }, now), null);
  assert.equal(doorHoldUntilError(undefined, now), null);
});

test("DOORBIRD_HOLD ueber /api/hub/tasks: Obergrenze und cameraId", () => {
  const until = new Date(now.getTime() + 60 * 60_000).toISOString();
  assert.deepEqual(checkHubTaskPayload("DOORBIRD_HOLD", { cameraId: 2, until, relay: 1 }, now), {
    ok: true,
    payload: { cameraId: 2, until, relay: 1 },
    cameraId: 2,
  });
  assert.equal(checkHubTaskPayload("DOORBIRD_HOLD", { cameraId: 2, until: null }, now).ok, true);
  const tooLong = new Date(now.getTime() + (DOOR_HOLD_MAX_MINUTES + 60) * 60_000).toISOString();
  assert.equal(checkHubTaskPayload("DOORBIRD_HOLD", { cameraId: 2, until: tooLong }, now).ok, false);
  assert.equal(checkHubTaskPayload("DOORBIRD_HOLD", { until }, now).ok, false);
  // Andere Typen pruefen kein until.
  assert.equal(checkHubTaskPayload("DOORBIRD_OPEN", { cameraId: 2, until: tooLong }, now).ok, true);
  assert.equal(checkHubTaskPayload("PING", { until: tooLong }, now).ok, true);
});

/**
 * Nachbildung von /api/devices/pi fuer ein Geraet: Setzen (Dashboard), Abholen
 * (GET), Meldung (POST mit pis_task) und Verfall – mit den reinen Regeln.
 */
function piSim() {
  let t = now.getTime();
  const row: { task: number; taskSetAt: Date | null; taskFetchedSetAt: Date | null } = {
    task: 0,
    taskSetAt: null,
    taskFetchedSetAt: null,
  };
  const expire = () => {
    if (piOpenTaskExpired(row.task, row.taskSetAt, new Date(t))) {
      row.task = 0;
      row.taskSetAt = null;
    }
  };
  return {
    row,
    wait(ms: number) {
      t += ms;
    },
    set(task: number) {
      row.task = task;
      row.taskSetAt = deviceTaskSetAt(task, new Date(t));
    },
    /** GET: liefert den Task, den der Pi sieht. */
    fetch(): number {
      expire();
      if (piOpenTaskNeedsFetchMark(row.task, row.taskSetAt, row.taskFetchedSetAt)) row.taskFetchedSetAt = row.taskSetAt;
      return row.task;
    },
    /**
     * POST, erster Schritt: Zeile lesen und den Schreibzugriff planen wie die
     * Route. Zwischen Lesen und Schreiben kann eine andere Anfrage laufen.
     */
    reportRead(reported: number) {
      expire();
      const read = { taskSetAt: row.taskSetAt };
      return { read, plan: piReportWrite(row.task, reported, row.taskSetAt, row.taskFetchedSetAt) };
    },
    /** POST, zweiter Schritt: schreiben; liefert den Task in der Antwort. */
    reportWrite({ read, plan }: { read: { taskSetAt: Date | null }; plan: ReturnType<typeof piReportWrite> }): number {
      const sameOrder =
        row.task === 1 && (row.taskSetAt?.getTime() ?? null) === (read.taskSetAt?.getTime() ?? null);
      if (!plan.guarded || sameOrder) Object.assign(row, plan.data);
      return plan.answerTask;
    },
    /** POST: Meldung des Pis; liefert den Task in der Antwort. */
    report(reported: number): number {
      return this.reportWrite(this.reportRead(reported));
    },
  };
}

test("Pi: Herzschlag vor der Abholung loescht ein frisches Einmal-Oeffnen nicht", () => {
  const pi = piSim();
  pi.set(1);
  pi.wait(1_000);
  // Herzschlag mit dem alten Stand 0: Auftrag bleibt stehen, die Antwort traegt 0.
  assert.equal(pi.report(0), 0);
  assert.equal(pi.row.task, 1);
  // Der naechste GET liefert ihn aus; Pi oeffnet und bestaetigt.
  assert.equal(pi.fetch(), 1);
  assert.equal(pi.report(0), 0);
  assert.equal(pi.row.task, 0);
  assert.equal(pi.fetch(), 0);
});

test("Pi: Setzen, Abholen, Bestaetigen wie bisher", () => {
  const pi = piSim();
  pi.set(1);
  pi.wait(2_000);
  assert.equal(pi.fetch(), 1);
  assert.equal(pi.report(0), 0);
  assert.equal(pi.fetch(), 0);
});

test("Pi: Herzschlag nach der Abholung setzt zurueck wie bisher", () => {
  const pi = piSim();
  pi.set(1);
  assert.equal(pi.fetch(), 1);
  pi.wait(500);
  assert.equal(pi.report(0), 0);
  assert.equal(pi.row.task, 0);
});

test("Pi: Herzschlag, Abholung, Bestaetigung", () => {
  const pi = piSim();
  pi.set(1);
  assert.equal(pi.report(0), 0);
  assert.equal(pi.fetch(), 1);
  assert.equal(pi.report(0), 0);
  assert.equal(pi.row.task, 0);
});

test("Pi: neu gesetzt nach der Abholung bleibt bis zur naechsten Abholung stehen", () => {
  const pi = piSim();
  pi.set(1);
  assert.equal(pi.fetch(), 1);
  pi.wait(1_000);
  pi.set(1); // zweiter Druck, bevor die Bestaetigung ankommt
  pi.wait(1);
  // Bestaetigung des ersten und ein Herzschlag lassen den zweiten stehen.
  assert.equal(pi.report(0), 0);
  assert.equal(pi.report(0), 0);
  assert.equal(pi.row.task, 1);
  assert.equal(pi.fetch(), 1);
  assert.equal(pi.report(0), 0);
  assert.equal(pi.row.task, 0);
});

test("Pi: nicht abgeholtes Einmal-Oeffnen verfaellt nach 60 s", () => {
  const pi = piSim();
  pi.set(1);
  pi.wait(30_000);
  assert.equal(pi.report(0), 0);
  assert.equal(pi.fetch(), 1);
  // Abgeholt, aber nie bestaetigt: verfaellt trotzdem.
  pi.wait(31_000);
  assert.equal(pi.fetch(), 0);
  assert.equal(pi.row.taskSetAt, null);
  const offline = piSim();
  offline.set(1);
  offline.wait(61_000);
  assert.equal(offline.report(0), 0);
  assert.equal(offline.fetch(), 0);
});

test("Pi: Meldung ungleich 0 liefert task=1 wie bisher aus und vermerkt es", () => {
  const pi = piSim();
  pi.set(1);
  assert.equal(pi.report(2), 1);
  assert.equal(pi.row.taskFetchedSetAt?.getTime(), pi.row.taskSetAt?.getTime());
  // Die Bestaetigung danach setzt zurueck.
  assert.equal(pi.report(0), 0);
  assert.equal(pi.row.task, 0);
});

/**
 * Pi mit seinen zwei Threads (raspberry-pi/emp_scanner/main.py): Task-Poll
 * (GET) und Herzschlag (POST mit dem eigenen Stand). Wendet ein Thread task=1
 * an, oeffnet er (grant), setzt den eigenen Stand auf 0 und meldet erst
 * danach die Oeffnung und 0; bis dahin ist dieser Thread belegt. Gezaehlt
 * wird, wie oft das Drehkreuz oeffnet.
 */
function piDevice() {
  const server = piSim();
  let current = 0;
  let grants = 0;
  const busy = { poll: false, heartbeat: false };
  const apply = (thread: "poll" | "heartbeat", task: number) => {
    if (task === current) return;
    current = task;
    if (task === 1) {
      grants += 1;
      current = 0;
      busy[thread] = true;
    }
  };
  return {
    server,
    get grants() {
      return grants;
    },
    poll() {
      if (!busy.poll) apply("poll", server.fetch());
    },
    heartbeat() {
      if (!busy.heartbeat) apply("heartbeat", server.report(current));
    },
    /** Der Thread, der geoeffnet hat, meldet die Oeffnung und bestaetigt mit 0. */
    confirm(thread: "poll" | "heartbeat") {
      server.report(0);
      busy[thread] = false;
    },
  };
}

test("Pi mit zwei Threads: Herzschlag vor dem GET oeffnet genau einmal", () => {
  const pi = piDevice();
  pi.server.set(1);
  pi.heartbeat(); // Herzschlag vor dem naechsten GET: nichts ausgeliefert
  assert.equal(pi.grants, 0);
  pi.poll(); // GET liefert aus, Poll-Thread oeffnet und meldet
  assert.equal(pi.grants, 1);
  pi.heartbeat(); // Herzschlag waehrend der Bestaetigung
  pi.poll(); // Poll-Thread ist noch mit der Meldung beschaeftigt
  pi.confirm("poll");
  pi.poll();
  pi.heartbeat();
  pi.poll();
  assert.equal(pi.grants, 1);
  assert.equal(pi.server.row.task, 0);
});

test("Pi mit zwei Threads: GET zuerst oeffnet genau einmal", () => {
  const pi = piDevice();
  pi.server.set(1);
  pi.poll();
  pi.heartbeat();
  pi.confirm("poll");
  pi.poll();
  assert.equal(pi.grants, 1);
  assert.equal(pi.server.row.task, 0);
});

test("Pi mit zwei Threads: zweiter Druck waehrend der ersten Oeffnung oeffnet ein zweites Mal", () => {
  const pi = piDevice();
  pi.server.set(1);
  pi.poll();
  pi.server.wait(1_000);
  pi.server.set(1);
  pi.confirm("poll"); // Bestaetigung des ersten Auftrags
  pi.heartbeat(); // Herzschlag vor dem naechsten GET
  pi.poll();
  assert.equal(pi.grants, 2);
  pi.confirm("poll");
  pi.poll();
  pi.heartbeat();
  assert.equal(pi.grants, 2);
  assert.equal(pi.server.row.task, 0);
});

test("Pi mit zwei Threads: ohne Abholung verfaellt der Auftrag nach 60 s", () => {
  const pi = piDevice();
  pi.server.set(1);
  pi.heartbeat();
  pi.server.wait(61_000);
  pi.poll();
  pi.heartbeat();
  assert.equal(pi.grants, 0);
  assert.equal(pi.server.row.task, 0);
});

test("Pi: alte Zeilen ohne taskSetAt verhalten sich wie bisher", () => {
  assert.equal(piReportClearsOpenTask(1, 0, null, null), true);
  assert.equal(piOpenTaskNeedsFetchMark(1, null, null), false);
  assert.equal(piReportClearsOpenTask(1, 1, null, null), false);
  assert.equal(piReportHoldsOpenTask(1, 0, null, null), false);
});

test("Pi: NOT-AUF und Deaktiviert bleiben unberuehrt", () => {
  for (const task of [2, 3]) {
    const pi = piSim();
    pi.set(task);
    assert.equal(pi.report(0), task);
    assert.equal(pi.fetch(), task);
    pi.wait(3_600_000);
    assert.equal(pi.report(0), task);
    assert.equal(pi.fetch(), task);
    assert.equal(piOpenTaskNeedsFetchMark(task, now, null), false);
    assert.equal(piReportClearsOpenTask(task, 0, now, now), false);
    assert.equal(piReportHoldsOpenTask(task, 0, now, null), false);
  }
  const idle = piSim();
  assert.equal(idle.report(0), 0);
  assert.equal(idle.fetch(), 0);
});

test("Pi: Schreibzugriff einer Meldung, der Task oder Vermerk aendert, ist an den gelesenen Auftrag gebunden", () => {
  const t1 = new Date("2026-11-24T12:00:00.000Z");
  const t0 = new Date("2026-11-24T11:59:00.000Z");
  for (const task of [0, 1, 2, 3]) {
    for (const reported of [0, 1, 2, 3]) {
      for (const setAt of [null, t1]) {
        for (const fetched of [null, t0, t1]) {
          const plan = piReportWrite(task, reported, setAt, fetched);
          const writes = Object.keys(plan.data).length > 0;
          assert.equal(plan.guarded, writes, `task ${task}, Meldung ${reported}`);
          if (task !== 1) {
            assert.deepEqual(plan, { data: {}, guarded: false, answerTask: task });
          }
          assert.ok(!("task" in plan.data && "taskFetchedSetAt" in plan.data));
        }
      }
    }
  }
  // Nicht abgeholt, Meldung 2: Auftrag geht mit der Antwort raus und wird vermerkt.
  assert.deepEqual(piReportWrite(1, 2, t1, null), { data: { taskFetchedSetAt: t1 }, guarded: true, answerTask: 1 });
  // Nicht abgeholt, Meldung 0: bleibt stehen, nichts wird vermerkt, Antwort 0.
  assert.deepEqual(piReportWrite(1, 0, t1, t0), { data: {}, guarded: false, answerTask: 0 });
  // Abgeholt, Meldung 0: zuruecksetzen.
  assert.deepEqual(piReportWrite(1, 0, t1, t1), { data: { task: 0, taskSetAt: null }, guarded: true, answerTask: 0 });
  // Alte Zeile ohne taskSetAt: wie bisher zuruecksetzen.
  assert.deepEqual(piReportWrite(1, 0, null, null), { data: { task: 0, taskSetAt: null }, guarded: true, answerTask: 0 });
});

test("Pi: spaete Meldung ueberschreibt den Vermerk eines neueren Auftrags nicht", () => {
  // Am Pi ist NOT-AUF aktiv (er meldet 2). Erster Klick T1, die Meldung liest T1.
  const pi = piSim();
  pi.set(1);
  const late = pi.reportRead(2);
  // Zweiter Klick T2, ein GET liefert und vermerkt T2.
  pi.wait(5);
  pi.set(1);
  const t2 = pi.row.taskSetAt;
  assert.equal(pi.fetch(), 1);
  assert.equal(pi.row.taskFetchedSetAt?.getTime(), t2?.getTime());
  // Erst jetzt schreibt die Meldung: Antwort 1 (T1), der Vermerk von T2 bleibt.
  assert.equal(pi.reportWrite(late), 1);
  assert.equal(pi.row.taskFetchedSetAt?.getTime(), t2?.getTime());
  // Die Bestaetigung setzt T2 zurueck; kein dritter Abruf liefert noch einmal 1.
  assert.equal(pi.report(0), 0);
  assert.equal(pi.row.task, 0);
  assert.equal(pi.fetch(), 0);
});

test("Pi: spaete Bestaetigung setzt einen neueren Auftrag nicht zurueck", () => {
  const pi = piSim();
  pi.set(1);
  assert.equal(pi.fetch(), 1);
  const late = pi.reportRead(0); // Bestaetigung von T1 gelesen
  pi.wait(5);
  pi.set(1); // T2
  assert.equal(pi.reportWrite(late), 0);
  assert.equal(pi.row.task, 1, "T2 bleibt stehen");
  assert.equal(pi.fetch(), 1);
  assert.equal(pi.report(0), 0);
  assert.equal(pi.row.task, 0);
});
