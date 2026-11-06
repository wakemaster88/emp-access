# Optischer Zoom und automatisches Folgen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schwenk-Kameras folgen Personen ab dem ersten Signal, Kameras mit Zoom-Objektiv liefern eine gezielte optische Nahaufnahme für Gesichtserkennung und Wächter, Zonen-Auswertungen pausieren, solange eine Kamera bewegt ist.

**Architecture:** Neuer Koordinator `CameraMotion` (`hub/src/camera-motion.ts`) mit reiner Logik in `camera-motion-rules.ts`. Kamerabefehle kommen über einen Treiber (`MotionDriver`), den `cameras.ts` für Reolink umsetzt; dadurch laufen alle Abläufe in Unit-Tests mit einem Fake-Treiber. `cameras.ts` meldet PERSON-/VEHICLE-Flanken, Handsteuerung und Regeln an den Koordinator; Gesichtserkennung, Wächter, Halteverbot, Parkfläche und Belegung fragen ihn.

**Tech Stack:** TypeScript (ESM, `tsx`), `node:test`, Reolink CGI-API (`GetAiCfg`/`SetAiCfg`, `GetPtzGuard`/`SetPtzGuard`, `GetZoomFocus`/`StartZoomFocus`, `PtzCtrl`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-06-optischer-zoom-und-folgen-design.md`.
- Optisch zoomen und folgen immer, auch im Betrieb.
- Zonen-Kameras zoomen höchstens 6 s, höchstens alle 2 min, nie bei Fahrzeug, folgen nie.
- Folgen höchstens 120 s, danach Grundstellung und 60 s Pause.
- Hand (Zentrale, Cloud, Assistent) sperrt die Automatik 5 min und bricht sie ohne Rückfahrt ab.
- Vom Tracking schreibt der Hub nur den Ein/Aus-Schalter und „Personen“ als Zielart.
- Notschalter `HUB_CAMERA_AUTOZOOM=off`, `HUB_CAMERA_AUTOFOLLOW=off`; Standard an.
- Kommentare und Logtexte auf Deutsch wie im übrigen Hub-Code; keine Secrets in Log oder Verbesserungslog.
- Prüfen: `./node_modules/.bin/tsc -p hub/tsconfig.json` (ESLint ignoriert `hub/**`) und `npm test`.
- Ausgangsstand 06.11.: `tsc` fehlerfrei, `npm test` 290/290.
- Ein Push auf `main` ist ein Deploy: Der Hub holt alle 5 min `origin/main` und startet neu.

## Abweichungen von der Spec

- Statt eines Mock-Reolink (gibt es im Repo nicht) testet ein Fake-Treiber die Abläufe in `camera-motion.test.ts`.
- Die Nahaufnahme gilt 45 s statt 15 s für Wächter und Gesichtserkennung gemeinsam: Der Wächter fragt nach dem Bildmodell, also 10–40 s nach dem Ereignis.
- Belegung wartet höchstens 20 s auf die Grundstellung und lässt die Kamera sonst für diese Runde aus (die nächste Runde misst wieder). So hängt auch eine Telegram-Anfrage „Wie voll ist es?“ nicht minutenlang.
- Halteverbot: Ein ausgelassenes Bild setzt die Standzeit nicht zurück (die Spec sagte „läuft nicht weiter“).

## Dateien

- Create `hub/src/camera-motion-rules.ts` – Konstanten, Zustand, Sperrgründe, Zoom-Rechnung, Tracking-Schalter, Zonen-Kamera.
- Create `hub/src/camera-motion-rules.test.ts`
- Create `hub/src/camera-motion.ts` – Koordinator `CameraMotion` und Treiber-Schnittstelle.
- Create `hub/src/camera-motion.test.ts`
- Modify `hub/src/cameras.ts` – Diagnose, Reolink-Treiber, Flanken, Hand/Regel, Nahaufnahme in der Gesichtserkennung, Wartezeit vor dem Fahrzeug-Burst.
- Modify `hub/src/tasks.ts` – Diagnose in `CAMERA_CAPS`, Hand bei `CAMERA_PTZ`/`CAMERA_ZOOM`.
- Modify `hub/src/index.ts` – Wiederherstellung beim Start.
- Modify `hub/src/improve-log.ts` – Art `follow`, zwei Hinweise.
- Modify `hub/src/agent/sentinel.ts` – Nahaufnahme statt eigenem Zoom, kein eigenes Folgen.
- Modify `hub/src/noparking.ts`, `hub/src/parking.ts`, `hub/src/occupancy.ts` – Grundstellung abwarten bzw. halten.
- Modify `hub/README.md`, `hub/IMPROVE.md`, Spec.

---

### Task 1: Diagnose in CAMERA_CAPS (nur lesen) und Deploy

**Files:**
- Modify: `hub/src/cameras.ts` (nach `getCameraCaps`, vor dem MAC-Abschnitt)
- Modify: `hub/src/tasks.ts:5-17` (Import), `hub/src/tasks.ts:278-287` (`CAMERA_CAPS`)

**Interfaces:**
- Produces: `getMotionDiagnostics(cameraId: number): Promise<Record<string, unknown>>` mit `{ aiCfg, ptzGuard, zoomFocus }` (je Kamerawert oder `{ error }`).

- [ ] **Step 1: Diagnosefunktion in `cameras.ts` nach `getCameraCaps` einfügen**

```ts
/**
 * Nur lesen: Tracking-, Wachpositions- und Zoom-Einstellungen roh, wie die
 * Kamera sie liefert (Diagnose fuer Folgen und Nahaufnahme, CAMERA_CAPS motion).
 */
export async function getMotionDiagnostics(cameraId: number): Promise<Record<string, unknown>> {
  const cam = await getControlCam(cameraId);
  await ensureLogin(cam);
  const channel = cam.config.channel;
  const read = (cmd: string) =>
    cgi(cam, cmd, { channel }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  return {
    aiCfg: await read("GetAiCfg"),
    ptzGuard: await read("GetPtzGuard"),
    zoomFocus: await read("GetZoomFocus"),
  };
}
```

- [ ] **Step 2: `tasks.ts` – Import ergänzen und `CAMERA_CAPS` erweitern**

Import-Block um `getMotionDiagnostics` ergänzen:

```ts
import {
  uploadSnapshot,
  cameraScene,
  captureSnapshot,
  ptzControl,
  cameraZoom,
  setSpotlight,
  setIrLights,
  setSiren,
  getPtzPresets,
  getCameraCaps,
  getMotionDiagnostics,
  ensureCameraConfigs,
} from "./cameras.js";
```

`CAMERA_CAPS` ersetzen:

```ts
    case "CAMERA_CAPS": {
      const cameraId = Number(task.payload?.cameraId);
      if (!Number.isInteger(cameraId)) return { success: false, error: "cameraId fehlt" };
      try {
        const caps = await getCameraCaps(cameraId, task.payload?.force === true);
        // Nur auf Nachfrage: Rohwerte fuer Folgen und Nahaufnahme.
        const motion = task.payload?.motion === true ? await getMotionDiagnostics(cameraId) : undefined;
        return { success: true, result: { cameraId, caps, ...(motion ? { motion } : {}) } };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
```

- [ ] **Step 3: Prüfen**

Run: `./node_modules/.bin/tsc -p hub/tsconfig.json && npm test 2>&1 | tail -8`
Expected: kein tsc-Fehler, `pass 290`, `fail 0`.

- [ ] **Step 4: Commit und Push (Deploy, nur lesend)**

```bash
git add hub/src/cameras.ts hub/src/tasks.ts
git commit -m "Hub: CAMERA_CAPS liefert auf Nachfrage Tracking-, Wachpositions- und Zoom-Rohwerte"
git push
```

- [ ] **Step 5: Checkpoint – Rohwerte abfragen**

Nach ≥ 6 min (Updater-Takt 5 min plus Neustart) per Neon (`aged-dust-42435910`, `accountId` 1) einstellen:

```sql
INSERT INTO "HubTask" (type, payload, "accountId")
SELECT 'CAMERA_CAPS', jsonb_build_object('cameraId', id, 'motion', true), 1
FROM unnest(ARRAY[2,3,4,5,7,9,10,13]) AS id RETURNING id;
```

Ergebnis lesen (`result->'motion'`). Fehlt `motion`, läuft der Hub noch auf dem alten Stand: 3 min warten, neu einstellen.

Festhalten in `hub/IMPROVE.md` (Abschnitt vom 06.11., „Nächster Schritt“ ersetzen): je Kamera vorhandene Schlüssel in `aiCfg` (`bSmartTrack`, `aiTrack`, `trackType`), `ptzGuard` (`bexistPos` oder Fehler), Zoom-Bereich.

Weiter mit Task 2 nur, wenn:
- `aiCfg` die Schalter auf oberster Ebene enthält (wie `readAutoTrack` heute) und
- es entweder `bSmartTrack` gibt oder `aiTrack` nur 0/1 annimmt.

Sonst anhalten und `readTrackingCfg` mit Aaron neu festlegen.

---

### Task 2: Reine Logik `camera-motion-rules.ts`

**Files:**
- Create: `hub/src/camera-motion-rules.ts`
- Test: `hub/src/camera-motion-rules.test.ts`

**Interfaces:**
- Consumes: `NormBox` aus `hub/src/person-crop-rules.ts`.
- Produces: Konstanten (`HAND_HOLD_MS`, `RULE_HOLD_MS`, `FOLLOW_MAX_MS`, `FOLLOW_COOLDOWN_MS`, `CLOSEUP_GAP_MS`, `CLOSEUP_GAP_ZONE_MS`, `CLOSEUP_ZONE_MAX_MS`, `CLOSEUP_CACHE_MS`, `HOME_SETTLE_MS`, `TRACK_RETRY_MS`, `TRACK_RECHECK_MS`, `GUARD_IDLE_MS`, `HOME_RETRY_MS`, `FOCUS_MS`, `CENTER_WAIT_MS`, `MIN_GAIN`), Typen `Hold`, `MotionState`, `MotionCamFlags`, `ZoomRange`, `ZoomPlan`, `TrackingCfg`, `ZoneFlags`, Funktionen `newMotionState(now)`, `activeHold(st, now)`, `isAtHome(st, now)`, `followBlocked(st, now, cam)`, `closeUpBlocked(st, now, cam, vehicleActive)`, `opticalFactor(model)`, `magnificationAt(pos, min, max, factor)`, `posForMagnification(m, min, max, factor)`, `maxCenterGain(box, margin?)`, `wantedGain(box, fill?)`, `planCloseUp(boxes, zoom, factor)`, `isCentered(box, tolX?, tolY?)`, `largestBox(boxes)`, `readTrackingCfg(cfg)`, `isZoneCamera(cfg, parkingHosts)`.

- [ ] **Step 1: Test schreiben (`hub/src/camera-motion-rules.test.ts`)**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOSEUP_GAP_MS,
  CLOSEUP_GAP_ZONE_MS,
  HOME_SETTLE_MS,
  closeUpBlocked,
  followBlocked,
  isAtHome,
  isCentered,
  isZoneCamera,
  magnificationAt,
  maxCenterGain,
  newMotionState,
  opticalFactor,
  planCloseUp,
  posForMagnification,
  readTrackingCfg,
} from "./camera-motion-rules.js";

const MID = { x: 0.45, y: 0.375, w: 0.1, h: 0.25 };
const WIDE = { pos: 0, min: 0, max: 33 };

test("Zoomfaktor je Modell, unbekannt vorsichtig 3", () => {
  assert.equal(opticalFactor("RLC-811A"), 5);
  assert.equal(opticalFactor("RLC-823A 16X"), 16);
  assert.equal(opticalFactor("RLC-823S1"), 3);
  assert.equal(opticalFactor(null), 3);
});

test("Zoom-Position und Vergrößerung linear", () => {
  assert.equal(magnificationAt(0, 0, 33, 5), 1);
  assert.equal(magnificationAt(33, 0, 33, 5), 5);
  assert.equal(posForMagnification(3, 0, 33, 5), 17);
  assert.equal(posForMagnification(9, 0, 33, 5), 33);
  assert.equal(posForMagnification(1, 0, 33, 5), 0);
});

test("Zoom zur Mitte: Person am Rand verträgt keinen Zoom", () => {
  assert.ok(maxCenterGain(MID) > 3);
  assert.ok(maxCenterGain({ x: 0.9, y: 0.4, w: 0.08, h: 0.2 }) < 1);
});

test("Nahaufnahme: Person in der Mitte füllt 60 % der Höhe", () => {
  const p = planCloseUp([MID], WIDE, 5)!;
  assert.ok(Math.abs(p.gain - 2.4) < 1e-9);
  assert.equal(p.pos, 12);
});

test("Nahaufnahme: kleine Person bei 16-fach, begrenzt durch den Bildrand", () => {
  const p = planCloseUp([{ x: 0.49, y: 0.47, w: 0.02, h: 0.05 }], WIDE, 16)!;
  // gewünscht wären 12-fach, der Rand erlaubt nur 0,5 / 0,06 ≈ 8,3
  assert.ok(Math.abs(p.gain - 0.5 / 0.06) < 1e-6);
});

test("Nahaufnahme: Gruppe passt nicht, dann die größte Person, die passt", () => {
  const edge = { x: 0.85, y: 0.3, w: 0.12, h: 0.4 };
  const mid = { x: 0.47, y: 0.42, w: 0.06, h: 0.15 };
  const p = planCloseUp([edge, mid], WIDE, 5)!;
  assert.deepEqual(p.box, mid);
});

test("Nahaufnahme: schon gezoomt oder ohne Personen nichts zu tun", () => {
  assert.equal(planCloseUp([MID], { pos: 33, min: 0, max: 33 }, 5), null);
  assert.equal(planCloseUp([], WIDE, 5), null);
});

test("Person nach dem Nachführen in der Bildmitte", () => {
  assert.equal(isCentered(MID), true);
  assert.equal(isCentered({ x: 0.05, y: 0.4, w: 0.1, h: 0.2 }), false);
});

test("Tracking-Schalter: bSmartTrack vor aiTrack, Personen als Zielart", () => {
  assert.deepEqual(readTrackingCfg({ bSmartTrack: 0, aiTrack: 3 }), { key: "bSmartTrack", on: false, peopleOff: false });
  assert.deepEqual(readTrackingCfg({ aiTrack: 1 }), { key: "aiTrack", on: true, peopleOff: false });
  assert.deepEqual(readTrackingCfg({ aiTrack: 0, trackType: { people: 0, vehicle: 1 } }), {
    key: "aiTrack",
    on: false,
    peopleOff: true,
  });
  assert.equal(readTrackingCfg({}), null);
});

test("Zonen-Kamera: Kennzeichen, Halteverbot, Lieferdienste oder Parkfläche", () => {
  const none = new Set<string>();
  assert.equal(isZoneCamera({ host: "a", vehicleDetection: false }, none), false);
  assert.equal(isZoneCamera({ host: "a", vehicleDetection: true }, none), true);
  assert.equal(isZoneCamera({ host: "a", vehicleDetection: false, noParkDetection: true }, none), true);
  assert.equal(isZoneCamera({ host: "a", vehicleDetection: false, deliveryMode: "NOTIFY" }, none), true);
  assert.equal(isZoneCamera({ host: "192.168.30.12", vehicleDetection: false }, new Set(["192.168.30.12"])), true);
});

test("Grundstellung: nicht während Folgen oder Nahaufnahme, erst nach dem Fokus", () => {
  const st = newMotionState(0);
  assert.equal(isAtHome(st, 0), true);
  st.following = true;
  assert.equal(isAtHome(st, 0), false);
  st.following = false;
  st.homeAt = 1_000;
  assert.equal(isAtHome(st, 1_000 + HOME_SETTLE_MS - 1), false);
  assert.equal(isAtHome(st, 1_000 + HOME_SETTLE_MS), true);
});

test("Folgen: nur Schwenk-Kameras ohne Zonen, Hand und Regel gehen vor", () => {
  const cam = { pan: true, zoom: false, zone: false };
  const st = newMotionState(0);
  assert.equal(followBlocked(st, 0, cam), null);
  assert.equal(followBlocked(st, 0, { ...cam, pan: false }), "kein Schwenkkopf");
  assert.equal(followBlocked(st, 0, { ...cam, zone: true }), "Zonen-Kamera");
  st.hold = { by: "hand", until: 1_000 };
  assert.equal(followBlocked(st, 999, cam), "Handsteuerung");
  assert.equal(followBlocked(st, 1_000, cam), null);
  st.followCooldownUntil = 2_000;
  assert.equal(followBlocked(st, 1_500, cam), "Pause nach dem Folgen");
});

test("Nahaufnahme: Abstand 30 s, an Zonen-Kameras 2 min und nie bei Fahrzeug", () => {
  const cam = { pan: false, zoom: true, zone: false };
  const zone = { ...cam, zone: true };
  const st = newMotionState(0);
  st.lastCloseUpAt = 0;
  assert.equal(closeUpBlocked(st, CLOSEUP_GAP_MS - 1, cam, false), "letzte Nahaufnahme zu kurz her");
  assert.equal(closeUpBlocked(st, CLOSEUP_GAP_MS, cam, false), null);
  assert.equal(closeUpBlocked(st, CLOSEUP_GAP_MS, zone, false), "letzte Nahaufnahme zu kurz her");
  assert.equal(closeUpBlocked(st, CLOSEUP_GAP_ZONE_MS, zone, false), null);
  assert.equal(closeUpBlocked(st, CLOSEUP_GAP_ZONE_MS, zone, true), "Fahrzeug an der Zonen-Kamera");
  assert.equal(closeUpBlocked(st, CLOSEUP_GAP_ZONE_MS, { ...cam, zoom: false }, false), "kein Zoom");
});
```

- [ ] **Step 2: Test laufen lassen**

Run: `node --import tsx --test hub/src/camera-motion-rules.test.ts`
Expected: FAIL, `Cannot find module './camera-motion-rules.js'`.

- [ ] **Step 3: `hub/src/camera-motion-rules.ts` anlegen**

```ts
/**
 * Kamera-Bewegungen fuer Personen (optischer Zoom, Folgen): reine Logik ohne
 * Ein-/Ausgabe. Ablauf und Kamerabefehle in camera-motion.ts, Design in
 * docs/superpowers/specs/2026-11-06-optischer-zoom-und-folgen-design.md.
 */
import type { NormBox } from "./person-crop-rules.js";

/** Handsteuerung (Zentrale, Cloud, Assistent) sperrt die Automatik so lange. */
export const HAND_HOLD_MS = 5 * 60_000;
/** Regel-Szene ohne Rueckkehrzeit sperrt die Automatik so lange. */
export const RULE_HOLD_MS = 5 * 60_000;
export const FOLLOW_MAX_MS = 120_000;
export const FOLLOW_COOLDOWN_MS = 60_000;
export const CLOSEUP_GAP_MS = 30_000;
export const CLOSEUP_GAP_ZONE_MS = 2 * 60_000;
export const CLOSEUP_ZONE_MAX_MS = 6_000;
/** Gesichtserkennung und Waechter (fragt erst nach dem Bildmodell) teilen sich eine Nahaufnahme. */
export const CLOSEUP_CACHE_MS = 45_000;
/** Nach der Rueckkehr: Fokus, bevor Zonen-Auswertungen wieder Bilder nehmen. */
export const HOME_SETTLE_MS = 3_000;
export const TRACK_RETRY_MS = 10 * 60_000;
/** Kein Tracking oder dauerhaft an: so lange nicht erneut fragen. */
export const TRACK_RECHECK_MS = 60 * 60_000;
/** Wachposition nur aus einer Stellung speichern, die so lange unbewegt war. */
export const GUARD_IDLE_MS = 10 * 60_000;
/** Ohne Grundstellung: so lange nicht erneut suchen. */
export const HOME_RETRY_MS = 60 * 60_000;
export const FOCUS_MS = 2_500;
export const CENTER_WAIT_MS = 3_000;
/** Darunter lohnt die optische Nahaufnahme nicht, der digitale Zoom reicht. */
export const MIN_GAIN = 1.3;

export interface Hold {
  by: "hand" | "rule";
  until: number;
}

export interface MotionState {
  hold: Hold | null;
  following: boolean;
  followUntil: number;
  followCooldownUntil: number;
  closeUp: boolean;
  /** Abbruch der laufenden Nahaufnahme: Hand (bleibt stehen) oder Fahrzeug (sofort zurueck). */
  abort: "hand" | "vehicle" | null;
  lastCloseUpAt: number;
  /** Letzte Rueckkehr in die Grundstellung. */
  homeAt: number;
  /** Letzte Bewegung (Hand, Regel, Automatik) – fuer das Speichern der Wachposition. */
  lastMovedAt: number;
  trackRetryAt: number;
}

export function newMotionState(now: number): MotionState {
  return {
    hold: null,
    following: false,
    followUntil: 0,
    followCooldownUntil: 0,
    closeUp: false,
    abort: null,
    lastCloseUpAt: Number.NEGATIVE_INFINITY,
    homeAt: Number.NEGATIVE_INFINITY,
    lastMovedAt: now,
    trackRetryAt: 0,
  };
}

export function activeHold(st: MotionState, now: number): Hold["by"] | null {
  return st.hold && now < st.hold.until ? st.hold.by : null;
}

/** Kamera in Grundstellung: keine Automatik aktiv und der Fokus hatte Zeit. */
export function isAtHome(st: MotionState, now: number): boolean {
  return !st.following && !st.closeUp && now - st.homeAt >= HOME_SETTLE_MS;
}

export interface MotionCamFlags {
  pan: boolean;
  zoom: boolean;
  zone: boolean;
}

/** Grund, warum die Kamera jetzt nicht folgen darf; null = darf. */
export function followBlocked(st: MotionState, now: number, cam: MotionCamFlags): string | null {
  if (!cam.pan) return "kein Schwenkkopf";
  if (cam.zone) return "Zonen-Kamera";
  const hold = activeHold(st, now);
  if (hold) return hold === "hand" ? "Handsteuerung" : "Regel";
  if (st.following) return "folgt schon";
  if (now < st.followCooldownUntil) return "Pause nach dem Folgen";
  if (now < st.trackRetryAt) return "Tracking zuletzt nicht möglich";
  return null;
}

/** Grund, warum jetzt keine Nahaufnahme geht; null = geht. */
export function closeUpBlocked(st: MotionState, now: number, cam: MotionCamFlags, vehicleActive: boolean): string | null {
  if (!cam.zoom) return "kein Zoom";
  const hold = activeHold(st, now);
  if (hold) return hold === "hand" ? "Handsteuerung" : "Regel";
  if (st.closeUp) return "Nahaufnahme läuft";
  if (cam.zone && vehicleActive) return "Fahrzeug an der Zonen-Kamera";
  if (now - st.lastCloseUpAt < (cam.zone ? CLOSEUP_GAP_ZONE_MS : CLOSEUP_GAP_MS)) return "letzte Nahaufnahme zu kurz her";
  return null;
}

const OPTICAL: Array<[RegExp, number]> = [
  [/RLC-823A 16X/i, 16],
  [/RLC-811A/i, 5],
];

/** Optischer Zoomfaktor je Modell; unbekannt vorsichtig 3. */
export function opticalFactor(model: string | null): number {
  if (model) for (const [re, f] of OPTICAL) if (re.test(model)) return f;
  return 3;
}

/** Vergroesserung bei einer Zoom-Position, linear angenommen. */
export function magnificationAt(pos: number, min: number, max: number, factor: number): number {
  if (max <= min || factor <= 1) return 1;
  const t = Math.min(1, Math.max(0, (pos - min) / (max - min)));
  return 1 + (factor - 1) * t;
}

export function posForMagnification(m: number, min: number, max: number, factor: number): number {
  if (max <= min || factor <= 1) return min;
  const t = Math.min(1, Math.max(0, (m - 1) / (factor - 1)));
  return Math.round(min + (max - min) * t);
}

/** Zoom zur Bildmitte: hoechste Vergroesserung, bei der die Box plus Rand im Bild bleibt. */
export function maxCenterGain(b: NormBox, margin = 0.03): number {
  const d = Math.max(
    Math.abs(b.x - margin - 0.5),
    Math.abs(b.x + b.w + margin - 0.5),
    Math.abs(b.y - margin - 0.5),
    Math.abs(b.y + b.h + margin - 0.5)
  );
  return d > 0 ? 0.5 / d : Number.POSITIVE_INFINITY;
}

/** Vergroesserung, bei der die Box 60 % der Bildhoehe fuellt. */
export function wantedGain(b: NormBox, fill = 0.6): number {
  return b.h > 0 ? fill / b.h : 1;
}

function boundingBox(boxes: NormBox[]): NormBox {
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export interface ZoomRange {
  pos: number;
  min: number;
  max: number;
}

export interface ZoomPlan {
  /** Ziel-Position des Zoom-Objektivs. */
  pos: number;
  /** Vergroesserung gegenueber dem aktuellen Bild. */
  gain: number;
  /** Box, auf die gezoomt wird (alle Personen oder eine). */
  box: NormBox;
  /** Vergroesserung vorher, ab Weitwinkel gerechnet. */
  from: number;
}

/**
 * Nahaufnahme planen: erst alle Personen zusammen, sonst die groesste Person,
 * fuer die sich mindestens MIN_GAIN ergibt. Der Zoom bleibt in der Bildmitte.
 */
export function planCloseUp(boxes: NormBox[], zoom: ZoomRange, factor: number): ZoomPlan | null {
  if (!boxes.length) return null;
  const from = magnificationAt(zoom.pos, zoom.min, zoom.max, factor);
  const room = factor / from;
  if (room < MIN_GAIN) return null;
  const candidates = [boundingBox(boxes), ...[...boxes].sort((a, b) => b.w * b.h - a.w * a.h)];
  for (const box of candidates) {
    const gain = Math.min(wantedGain(box), maxCenterGain(box), room);
    if (gain >= MIN_GAIN) {
      return { pos: posForMagnification(from * gain, zoom.min, zoom.max, factor), gain, box, from };
    }
  }
  return null;
}

/** Steht die Person nach dem Nachfuehren etwa in der Bildmitte? */
export function isCentered(b: NormBox, tolX = 0.15, tolY = 0.25): boolean {
  return Math.abs(b.x + b.w / 2 - 0.5) <= tolX && Math.abs(b.y + b.h / 2 - 0.5) <= tolY;
}

export function largestBox(boxes: NormBox[]): NormBox | null {
  return boxes.length ? boxes.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a)) : null;
}

export interface TrackingCfg {
  /** Schalter in Get/SetAiCfg: `bSmartTrack` (Ein/Aus), sonst `aiTrack`. */
  key: "bSmartTrack" | "aiTrack";
  on: boolean;
  /** Personen sind als Zielart vorhanden, aber aus. */
  peopleOff: boolean;
}

export function readTrackingCfg(cfg: Record<string, unknown>): TrackingCfg | null {
  const key = typeof cfg.bSmartTrack === "number" ? "bSmartTrack" : typeof cfg.aiTrack === "number" ? "aiTrack" : null;
  if (!key) return null;
  const types = cfg.trackType as Record<string, unknown> | undefined;
  return { key, on: cfg[key] !== 0, peopleOff: typeof types?.people === "number" && types.people === 0 };
}

export interface ZoneFlags {
  host: string;
  vehicleDetection?: boolean;
  noParkDetection?: boolean;
  deliveryMode?: string | null;
}

/** Kamera mit festem Bildausschnitt fuer Auswertungen (Kennzeichen, Halteverbot, Lieferdienste, Parkflaeche). */
export function isZoneCamera(c: ZoneFlags, parkingHosts: ReadonlySet<string>): boolean {
  return c.vehicleDetection !== false || c.noParkDetection === true || !!c.deliveryMode || parkingHosts.has(c.host);
}
```

- [ ] **Step 4: Test laufen lassen**

Run: `node --import tsx --test hub/src/camera-motion-rules.test.ts`
Expected: PASS, 13 Tests.

- [ ] **Step 5: Commit**

```bash
git add hub/src/camera-motion-rules.ts hub/src/camera-motion-rules.test.ts
git commit -m "Hub: Regeln für Folgen und optische Nahaufnahme (Zoom-Rechnung, Sperrgründe)"
```

---

### Task 3: Koordinator `CameraMotion` mit Tests

**Files:**
- Create: `hub/src/camera-motion.ts`
- Test: `hub/src/camera-motion.test.ts`

**Interfaces:**
- Consumes: alles aus Task 2.
- Produces:
  - Typen `MotionCam { id; name; model: string | null; pan; zoom; zone }`, `GuardInfo { supported; exists }`, `PersistedMove { cameraId; following; trackKey: string | null; zoomHome: number | null }`, `CloseUp { jpeg: Buffer; at; gain; persons }`, `MotionDriver` (siehe Code).
  - Klasse `CameraMotion(driver, { follow, zoom })` mit `onPersonStart(id): Promise<void>`, `onPersonEnd(id): Promise<void>`, `onVehicleStart(id): void`, `noteHand(id): Promise<void>`, `noteRule(id, ms): void`, `tick(): Promise<void>`, `closeUp(id): Promise<CloseUp | null>`, `atHome(id): boolean`, `waitAtHome(id, maxMs): Promise<boolean>`, `isFollowing(id): boolean`, `restore(): Promise<void>`.

- [ ] **Step 1: Test schreiben (`hub/src/camera-motion.test.ts`)**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CameraMotion, type GuardInfo, type MotionCam, type MotionDriver, type PersistedMove } from "./camera-motion.js";
import type { ZoomRange } from "./camera-motion-rules.js";
import type { NormBox } from "./person-crop-rules.js";

const MID: NormBox = { x: 0.45, y: 0.375, w: 0.1, h: 0.25 };
const LEFT: NormBox = { x: 0.05, y: 0.4, w: 0.1, h: 0.2 };

const PTZ: MotionCam = { id: 5, name: "Übungslift", model: "RLC-823A 16X", pan: true, zoom: true, zone: false };
const PAN: MotionCam = { id: 7, name: "Shop", model: "E1 Pro", pan: true, zoom: false, zone: false };
const ZOOM: MotionCam = { id: 4, name: "Seilbahn B", model: "RLC-811A", pan: false, zoom: true, zone: false };
const ZONE: MotionCam = { id: 9, name: "Eingang", model: "RLC-811A", pan: false, zoom: true, zone: true };

class FakeDriver implements MotionDriver {
  t = 1_000_000;
  calls: string[] = [];
  counts: string[] = [];
  cams = new Map<number, MotionCam>();
  zoom = new Map<number, ZoomRange>();
  ai = new Map<number, Record<string, unknown>>();
  guards = new Map<number, GuardInfo>();
  presetList = new Map<number, Array<{ id: number; name: string }>>();
  boxes: Array<NormBox[] | null> = [];
  fallbackBoxes: NormBox[] | null = [MID];
  vehicles = new Set<number>();
  stored: PersistedMove[] = [];
  saved: PersistedMove[] = [];
  onSleep: (() => void) | null = null;
  now() {
    return this.t;
  }
  async sleep(ms: number) {
    this.t += ms;
    this.onSleep?.();
  }
  async camera(id: number) {
    return this.cams.get(id) ?? null;
  }
  async readZoom(id: number) {
    return { ...this.zoom.get(id)! };
  }
  async writeZoom(id: number, pos: number) {
    this.calls.push(`zoom ${id} ${pos}`);
    this.zoom.set(id, { ...this.zoom.get(id)!, pos });
  }
  async readTracking(id: number) {
    return { ...(this.ai.get(id) ?? {}) };
  }
  async writeTracking(id: number, patch: Record<string, unknown>) {
    this.calls.push(`track ${id} ${JSON.stringify(patch)}`);
    this.ai.set(id, { ...this.ai.get(id), ...patch });
  }
  async readGuard(id: number) {
    return this.guards.get(id) ?? { supported: false, exists: false };
  }
  async guard(id: number, cmd: "toPos" | "setPos") {
    this.calls.push(`guard ${id} ${cmd}`);
  }
  async presets(id: number) {
    return this.presetList.get(id) ?? [];
  }
  async gotoPreset(id: number, presetId: number) {
    this.calls.push(`preset ${id} ${presetId}`);
  }
  async snap(id: number) {
    return Buffer.from(`snap ${id} ${this.t}`);
  }
  async persons() {
    return this.boxes.length ? this.boxes.shift()! : this.fallbackBoxes;
  }
  vehicleActive(id: number) {
    return this.vehicles.has(id);
  }
  async save(moves: PersistedMove[]) {
    this.saved = moves;
  }
  async load() {
    return this.stored;
  }
  log() {}
  count(kind: string, event: string) {
    this.counts.push(`${kind}.${event}`);
  }
}

function setup(...cams: MotionCam[]) {
  const d = new FakeDriver();
  for (const c of cams) {
    d.cams.set(c.id, c);
    d.zoom.set(c.id, { pos: 0, min: 0, max: 33 });
    d.ai.set(c.id, { bSmartTrack: 0, aiTrack: 0, trackType: { people: 1, vehicle: 0 } });
    d.guards.set(c.id, { supported: true, exists: true });
  }
  return { d, m: new CameraMotion(d, { follow: true, zoom: true }) };
}

test("Schwenk-Kamera folgt, bei „Person weg“ zurück in die Wachposition, dann 1 min Pause", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), true);
  assert.equal(m.atHome(7), false);
  assert.deepEqual(d.calls, ['track 7 {"bSmartTrack":1}']);
  assert.equal(d.saved.length, 1);
  await m.onPersonEnd(7);
  assert.deepEqual(d.calls.slice(1), ['track 7 {"bSmartTrack":0}', "guard 7 toPos"]);
  assert.equal(m.isFollowing(7), false);
  assert.deepEqual(d.counts, ["follow.start", "follow.end_gone"]);
  assert.equal(d.saved.length, 0);
  d.t += 30_000;
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), false);
  d.t += 31_000;
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), true);
});

test("Folgen endet spätestens nach 120 s", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  d.t += 119_000;
  await m.tick();
  assert.equal(m.isFollowing(7), true);
  d.t += 1_000;
  await m.tick();
  assert.equal(m.isFollowing(7), false);
  assert.ok(d.counts.includes("follow.end_max"));
  assert.equal(d.calls.at(-1), "guard 7 toPos");
});

test("Hand bricht das Folgen ab, ohne zurückzufahren, und sperrt 5 min", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  await m.noteHand(7);
  assert.deepEqual(d.calls, ['track 7 {"bSmartTrack":1}', 'track 7 {"bSmartTrack":0}']);
  assert.deepEqual(d.counts, ["follow.start", "follow.end_hand"]);
  d.t += 4 * 60_000;
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), false);
  d.t += 61_000;
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), true);
});

test("Regel übernimmt: Automatik hält still, bis sie fertig ist", async () => {
  const { d, m } = setup(PAN);
  await m.onPersonStart(7);
  m.noteRule(7, 30_000);
  assert.equal(m.isFollowing(7), false);
  assert.deepEqual(d.calls, ['track 7 {"bSmartTrack":1}']);
  d.t += 10_000;
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), false);
  d.t += 21_000;
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), true);
});

test("Tracking schon dauerhaft an: Hub greift nicht ein", async () => {
  const { d, m } = setup(PAN);
  d.ai.set(7, { bSmartTrack: 1 });
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), false);
  assert.deepEqual(d.calls, []);
  assert.deepEqual(d.counts, ["follow.camera_tracks"]);
});

test("Personen als Zielart aus: Hub schaltet sie mit ein, sonst nichts", async () => {
  const { d, m } = setup(PAN);
  d.ai.set(7, { aiTrack: 0, trackType: { people: 0, vehicle: 1 } });
  await m.onPersonStart(7);
  assert.deepEqual(d.calls, ['track 7 {"aiTrack":1,"trackType":{"people":1,"vehicle":1}}']);
});

test("Ohne Wachposition: Preset „Grundstellung“, sonst kein Folgen", async () => {
  const gastro: MotionCam = { ...PAN, id: 2, name: "Gastro" };
  const { d, m } = setup(PAN, gastro);
  d.guards.set(7, { supported: false, exists: false });
  d.presetList.set(7, [{ id: 3, name: "Grundstellung" }]);
  d.guards.set(2, { supported: false, exists: false });
  await m.onPersonStart(7);
  await m.onPersonEnd(7);
  assert.equal(d.calls.at(-1), "preset 7 3");
  await m.onPersonStart(2);
  assert.equal(m.isFollowing(2), false);
  assert.ok(d.counts.includes("follow.no_home"));
});

test("Wachposition fehlt: erst nach 10 min ohne Bewegung speichern", async () => {
  const { d, m } = setup(PAN);
  d.guards.set(7, { supported: true, exists: false });
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), false);
  d.t += 10 * 60_000;
  await m.onPersonStart(7);
  assert.equal(m.isFollowing(7), true);
  assert.deepEqual(d.calls, ["guard 7 setPos", 'track 7 {"bSmartTrack":1}']);
});

test("Zonen-Kamera folgt nie", async () => {
  const { d, m } = setup({ ...PAN, id: 13, zone: true });
  await m.onPersonStart(13);
  assert.equal(m.isFollowing(13), false);
  assert.deepEqual(d.calls, []);
});

test("Zoom-Kamera: Nahaufnahme auf die Person in der Mitte, danach zurück; Ergebnis wird geteilt", async () => {
  const { d, m } = setup(ZOOM);
  const shot = await m.closeUp(4);
  assert.ok(shot);
  assert.ok(Math.abs(shot.gain - 2.4) < 1e-9);
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0"]);
  assert.equal(m.atHome(4), false);
  d.t += 3_000;
  assert.equal(m.atHome(4), true);
  assert.equal(await m.closeUp(4), shot);
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 0"]);
  assert.ok(d.counts.includes("camera.zoom_ratio"));
});

test("Person am Rand: keine Nahaufnahme, der Zoom bleibt", async () => {
  const { d, m } = setup(ZOOM);
  d.fallbackBoxes = [{ x: 0.9, y: 0.4, w: 0.08, h: 0.2 }];
  assert.equal(await m.closeUp(4), null);
  assert.deepEqual(d.calls, []);
  assert.ok(d.counts.includes("camera.closeup_skip"));
});

test("Person verloren: einmal halb so weit, dann aufgeben und zurück", async () => {
  const { d, m } = setup(ZOOM);
  d.boxes = [[MID], [], []];
  assert.equal(await m.closeUp(4), null);
  assert.deepEqual(d.calls, ["zoom 4 12", "zoom 4 6", "zoom 4 0"]);
  assert.ok(d.counts.includes("camera.closeup_lost"));
});

test("Zonen-Kamera: nicht bei Fahrzeug, kein zweiter Versuch, höchstens alle 2 min", async () => {
  const { d, m } = setup(ZONE);
  d.vehicles.add(9);
  assert.equal(await m.closeUp(9), null);
  assert.deepEqual(d.calls, []);
  d.vehicles.clear();
  d.boxes = [[MID], []];
  assert.equal(await m.closeUp(9), null);
  assert.deepEqual(d.calls, ["zoom 9 12", "zoom 9 0"]);
  d.t += 60_000;
  assert.equal(await m.closeUp(9), null);
  assert.deepEqual(d.calls, ["zoom 9 12", "zoom 9 0"]);
});

test("Fahrzeug während der Nahaufnahme an der Zonen-Kamera: sofort zurück", async () => {
  const { d, m } = setup(ZONE);
  d.onSleep = () => m.onVehicleStart(9);
  assert.equal(await m.closeUp(9), null);
  assert.deepEqual(d.calls, ["zoom 9 12", "zoom 9 0"]);
  assert.ok(d.counts.includes("camera.closeup_abort"));
});

test("Hand während der Nahaufnahme: der Zoom bleibt, wo er ist", async () => {
  const { d, m } = setup(ZOOM);
  d.onSleep = () => void m.noteHand(4);
  assert.equal(await m.closeUp(4), null);
  assert.deepEqual(d.calls, ["zoom 4 12"]);
});

test("Schwenk-Kamera mit Zoom: erst zentrieren lassen, dann zoomen, Folgen läuft weiter", async () => {
  const { d, m } = setup(PTZ);
  d.boxes = [[LEFT], [MID], [MID]];
  const shot = await m.closeUp(5);
  assert.ok(shot);
  assert.equal(m.isFollowing(5), true);
  assert.deepEqual(d.calls, ['track 5 {"bSmartTrack":1}', "zoom 5 3", "zoom 5 0"]);
});

test("Neustart: unterbrochene Bewegung wird zurückgestellt", async () => {
  const { d, m } = setup(PTZ);
  d.stored = [{ cameraId: 5, following: true, trackKey: "bSmartTrack", zoomHome: 4 }];
  await m.restore();
  assert.deepEqual(d.calls, ['track 5 {"bSmartTrack":0}', "zoom 5 4", "guard 5 toPos"]);
  assert.deepEqual(d.saved, []);
});

test("Abgeschaltet: weder Folgen noch Nahaufnahme", async () => {
  const d = new FakeDriver();
  d.cams.set(5, PTZ);
  d.zoom.set(5, { pos: 0, min: 0, max: 33 });
  d.ai.set(5, { bSmartTrack: 0 });
  d.guards.set(5, { supported: true, exists: true });
  const m = new CameraMotion(d, { follow: false, zoom: false });
  await m.onPersonStart(5);
  assert.equal(await m.closeUp(5), null);
  assert.deepEqual(d.calls, []);
});
```

- [ ] **Step 2: Test laufen lassen**

Run: `node --import tsx --test hub/src/camera-motion.test.ts`
Expected: FAIL, `Cannot find module './camera-motion.js'`.

- [ ] **Step 3: `hub/src/camera-motion.ts` anlegen**

```ts
/**
 * Kamera-Bewegungen fuer Personen: Schwenk-Kameras folgen (Tracking der
 * Kamera), Kameras mit Zoom-Objektiv machen eine gezielte optische
 * Nahaufnahme. Haelt je Kamera fest, wer sie bewegt (Hand > Regel >
 * Automatik), und bringt sie immer in die Grundstellung zurueck.
 * Kamerabefehle kommen ueber den Treiber (Reolink in cameras.ts).
 */
import type { NormBox } from "./person-crop-rules.js";
import {
  CENTER_WAIT_MS,
  CLOSEUP_CACHE_MS,
  CLOSEUP_ZONE_MAX_MS,
  FOCUS_MS,
  FOLLOW_COOLDOWN_MS,
  FOLLOW_MAX_MS,
  GUARD_IDLE_MS,
  HAND_HOLD_MS,
  HOME_RETRY_MS,
  TRACK_RECHECK_MS,
  TRACK_RETRY_MS,
  closeUpBlocked,
  followBlocked,
  isAtHome,
  isCentered,
  largestBox,
  newMotionState,
  opticalFactor,
  planCloseUp,
  posForMagnification,
  readTrackingCfg,
  type MotionState,
  type ZoomRange,
} from "./camera-motion-rules.js";

export interface MotionCam {
  id: number;
  name: string;
  model: string | null;
  pan: boolean;
  zoom: boolean;
  zone: boolean;
}

export interface GuardInfo {
  supported: boolean;
  exists: boolean;
}

/** Laufende Bewegung, die ein Hub-Neustart zurueckstellen muss. */
export interface PersistedMove {
  cameraId: number;
  following: boolean;
  /** Tracking-Schalter, den der Hub eingeschaltet hat. */
  trackKey: string | null;
  /** Zoom-Position vor der Nahaufnahme. */
  zoomHome: number | null;
}

export interface CloseUp {
  jpeg: Buffer;
  at: number;
  /** Vergroesserung gegenueber dem Bild vorher. */
  gain: number;
  persons: number;
}

export interface MotionDriver {
  now(): number;
  sleep(ms: number): Promise<void>;
  camera(id: number): Promise<MotionCam | null>;
  readZoom(id: number): Promise<ZoomRange>;
  writeZoom(id: number, pos: number): Promise<void>;
  /** GetAiCfg, roh. */
  readTracking(id: number): Promise<Record<string, unknown>>;
  /** SetAiCfg mit nur diesen Werten. */
  writeTracking(id: number, patch: Record<string, unknown>): Promise<void>;
  readGuard(id: number): Promise<GuardInfo>;
  guard(id: number, cmd: "toPos" | "setPos"): Promise<void>;
  presets(id: number): Promise<Array<{ id: number; name: string }>>;
  gotoPreset(id: number, presetId: number): Promise<void>;
  snap(id: number): Promise<Buffer>;
  persons(jpeg: Buffer): Promise<NormBox[] | null>;
  vehicleActive(id: number): boolean;
  save(moves: PersistedMove[]): Promise<void>;
  load(): Promise<PersistedMove[]>;
  log(msg: string): void;
  count(kind: "follow" | "camera", event: string, data?: Record<string, unknown>): void;
}

type Home = { kind: "guard" } | { kind: "preset"; id: number };

export class CameraMotion {
  private readonly states = new Map<number, MotionState>();
  private readonly homes = new Map<number, { home: Home | null; at: number }>();
  private readonly trackKeys = new Map<number, string>();
  private readonly zoomHomes = new Map<number, number>();
  private readonly closeUps = new Map<number, { at: number; result: CloseUp | null; run: Promise<CloseUp | null> | null }>();
  private readonly queues = new Map<number, Promise<unknown>>();
  private readonly startedAt: number;
  private ready: Promise<void> = Promise.resolve();

  constructor(
    private readonly d: MotionDriver,
    private readonly opts: { follow: boolean; zoom: boolean }
  ) {
    this.startedAt = d.now();
  }

  isFollowing(id: number): boolean {
    return this.states.get(id)?.following ?? false;
  }

  /** Kamera in Grundstellung (Zonen-Auswertungen duerfen Bilder nehmen). */
  atHome(id: number): boolean {
    const st = this.states.get(id);
    return !st || isAtHome(st, this.d.now());
  }

  async waitAtHome(id: number, maxMs: number): Promise<boolean> {
    const until = this.d.now() + maxMs;
    while (!this.atHome(id)) {
      if (this.d.now() >= until) return false;
      await this.d.sleep(500);
    }
    return true;
  }

  /** Steigende PERSON-Flanke: Schwenk-Kamera folgen lassen. */
  async onPersonStart(id: number): Promise<void> {
    if (!this.opts.follow) return;
    await this.ready;
    const cam = await this.d.camera(id);
    if (!cam || followBlocked(this.state(id), this.d.now(), cam)) return;
    await this.serial(id, () => this.startFollow(cam));
  }

  /** PERSON entprellt beendet: Folgen beenden, zurueck in die Grundstellung. */
  async onPersonEnd(id: number): Promise<void> {
    if (!this.states.get(id)?.following) return;
    await this.serial(id, () => this.endFollow(id, "gone"));
  }

  /** Fahrzeug erkannt: eine laufende Nahaufnahme an einer Zonen-Kamera bricht ab. */
  onVehicleStart(id: number): void {
    const st = this.states.get(id);
    if (st?.closeUp && st.abort == null) st.abort = "vehicle";
  }

  /** Handsteuerung: Automatik sofort beenden (ohne Rueckfahrt), 5 min Ruhe. */
  noteHand(id: number): Promise<void> {
    const st = this.state(id);
    const now = this.d.now();
    st.hold = { by: "hand", until: now + HAND_HOLD_MS };
    st.lastMovedAt = now;
    if (st.closeUp) st.abort = "hand";
    if (!st.following) return Promise.resolve();
    return this.serial(id, () => this.endFollow(id, "hand")).catch((e) => this.fail("Handsteuerung", e));
  }

  /** Regel „Kamera steuern“ uebernimmt; sie stellt das Tracking selbst. */
  noteRule(id: number, ms: number): void {
    const st = this.state(id);
    const now = this.d.now();
    st.hold = { by: "rule", until: now + ms };
    st.lastMovedAt = now;
    if (st.closeUp) st.abort = "hand";
    if (st.following) {
      st.following = false;
      this.trackKeys.delete(id);
      this.d.count("follow", "end_rule");
      void this.persist();
    }
  }

  /** Bei jedem Kamera-Poll: Folgen nach FOLLOW_MAX_MS beenden. */
  async tick(): Promise<void> {
    const now = this.d.now();
    const due: number[] = [];
    for (const [id, st] of this.states) {
      if (st.following && now >= st.followUntil) {
        st.followUntil = Number.POSITIVE_INFINITY;
        due.push(id);
      }
    }
    await Promise.all(due.map((id) => this.serial(id, () => this.endFollow(id, "max")).catch((e) => this.fail("Folgen beenden", e))));
  }

  /** Optische Nahaufnahme der Personen; null = geht nicht oder lohnt nicht (dann digital). */
  async closeUp(id: number): Promise<CloseUp | null> {
    if (!this.opts.zoom) return null;
    await this.ready;
    const now = this.d.now();
    const cached = this.closeUps.get(id);
    if (cached?.run) return cached.run;
    if (cached && now - cached.at < CLOSEUP_CACHE_MS) return cached.result;
    const cam = await this.d.camera(id);
    if (!cam || closeUpBlocked(this.state(id), now, cam, this.d.vehicleActive(id))) return null;
    const run = this.serial(id, () => this.runCloseUp(cam)).catch((e) => {
      this.fail(`${cam.name}: Nahaufnahme`, e);
      return null;
    });
    this.closeUps.set(id, { at: now, result: null, run });
    const result = await run;
    this.closeUps.set(id, { at: this.d.now(), result, run: null });
    return result;
  }

  /** Hub-Start: Bewegungen zurueckstellen, die ein Neustart unterbrochen hat. */
  restore(): Promise<void> {
    this.ready = (async () => {
      const moves = await this.d.load().catch(() => [] as PersistedMove[]);
      for (const m of moves) {
        try {
          if (m.trackKey) await this.d.writeTracking(m.cameraId, { [m.trackKey]: 0 });
          if (m.zoomHome != null) await this.d.writeZoom(m.cameraId, m.zoomHome);
          if (m.following) {
            const cam = await this.d.camera(m.cameraId);
            if (cam && (await this.ensureHome(cam))) await this.goHome(m.cameraId);
          }
          this.d.log(`Kamera ${m.cameraId}: nach Neustart zurückgestellt`);
        } catch (e) {
          this.fail(`Kamera ${m.cameraId} zurückstellen`, e);
        }
      }
      if (moves.length) await this.d.save([]).catch(() => undefined);
    })();
    return this.ready;
  }

  private state(id: number): MotionState {
    let st = this.states.get(id);
    if (!st) {
      st = newMotionState(this.startedAt);
      this.states.set(id, st);
    }
    return st;
  }

  /** Ablaeufe je Kamera nacheinander (Folgen, Nahaufnahme, Rueckkehr). */
  private serial<T>(id: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.queues.set(id, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (this.queues.get(id) === next) this.queues.delete(id);
      });
    return next;
  }

  private fail(what: string, e: unknown): void {
    this.d.log(`Kamera-Bewegung: ${what}: ${e instanceof Error ? e.message : e}`);
  }

  private async startFollow(cam: MotionCam): Promise<boolean> {
    const st = this.state(cam.id);
    const now = this.d.now();
    if (followBlocked(st, now, cam)) return false;
    if (!(await this.ensureHome(cam))) return false;
    let cfg: Record<string, unknown>;
    try {
      cfg = await this.d.readTracking(cam.id);
    } catch (e) {
      st.trackRetryAt = now + TRACK_RETRY_MS;
      this.d.count("follow", "track_fail", { cam: cam.name });
      this.fail(`${cam.name}: Tracking lesen`, e);
      return false;
    }
    const info = readTrackingCfg(cfg);
    if (!info || info.on) {
      // Ohne Tracking kann die Kamera nicht folgen; dauerhaft an heisst, sie folgt selbst.
      st.trackRetryAt = now + TRACK_RECHECK_MS;
      this.d.log(`Kamera ${cam.name}: ${info ? "Tracking dauerhaft an – Hub greift nicht ein" : "kein Tracking in GetAiCfg – folgt nicht"}`);
      this.d.count("follow", info ? "camera_tracks" : "no_tracking", { cam: cam.name });
      return false;
    }
    const patch: Record<string, unknown> = { [info.key]: 1 };
    if (info.peopleOff) patch.trackType = { ...(cfg.trackType as Record<string, unknown>), people: 1 };
    try {
      await this.d.writeTracking(cam.id, patch);
    } catch (e) {
      st.trackRetryAt = now + TRACK_RETRY_MS;
      this.d.count("follow", "track_fail", { cam: cam.name });
      this.fail(`${cam.name}: Tracking einschalten`, e);
      return false;
    }
    if (info.peopleOff) this.d.log(`Kamera ${cam.name}: Tracking für Personen eingeschaltet`);
    st.following = true;
    st.followUntil = now + FOLLOW_MAX_MS;
    st.lastMovedAt = now;
    this.trackKeys.set(cam.id, info.key);
    await this.persist();
    this.d.count("follow", "start", { cam: cam.name });
    this.d.log(`Kamera ${cam.name}: folgt der Person (höchstens ${FOLLOW_MAX_MS / 1000} s)`);
    return true;
  }

  private async endFollow(id: number, why: "gone" | "max" | "hand"): Promise<void> {
    const st = this.state(id);
    if (!st.following) return;
    const key = this.trackKeys.get(id);
    if (key) await this.d.writeTracking(id, { [key]: 0 }).catch((e) => this.fail("Tracking ausschalten", e));
    this.trackKeys.delete(id);
    st.following = false;
    st.lastMovedAt = this.d.now();
    if (why === "hand") {
      this.d.count("follow", "end_hand");
    } else {
      const ok = await this.goHome(id);
      st.followCooldownUntil = this.d.now() + FOLLOW_COOLDOWN_MS;
      st.homeAt = this.d.now();
      this.d.count("follow", ok ? (why === "gone" ? "end_gone" : "end_max") : "home_fail", { cam: id });
    }
    await this.persist();
  }

  private async goHome(id: number): Promise<boolean> {
    const home = this.homes.get(id)?.home;
    if (!home) return false;
    try {
      if (home.kind === "guard") await this.d.guard(id, "toPos");
      else await this.d.gotoPreset(id, home.id);
      return true;
    } catch (e) {
      this.fail("Grundstellung anfahren", e);
      return false;
    }
  }

  /**
   * Grundstellung: Wachposition der Kamera; fehlt sie, die aktuelle Stellung
   * speichern (nur nach 10 min ohne Bewegung); ohne Wachposition ein Preset
   * „Grundstellung“. Sonst folgt die Kamera nicht.
   */
  private async ensureHome(cam: MotionCam): Promise<Home | null> {
    const now = this.d.now();
    const known = this.homes.get(cam.id);
    if (known && (known.home || now - known.at < HOME_RETRY_MS)) return known.home;
    const guard = await this.d.readGuard(cam.id).catch(() => ({ supported: false, exists: false }));
    let home: Home | null = null;
    if (guard.supported && guard.exists) {
      home = { kind: "guard" };
    } else if (guard.supported) {
      if (now - this.state(cam.id).lastMovedAt < GUARD_IDLE_MS) return null;
      try {
        await this.d.guard(cam.id, "setPos");
        this.d.log(`Kamera ${cam.name}: aktuelle Stellung als Grundstellung (Wachposition) gespeichert`);
        home = { kind: "guard" };
      } catch (e) {
        this.fail(`${cam.name}: Wachposition speichern`, e);
      }
    }
    if (!home) {
      const presets = await this.d.presets(cam.id).catch(() => [] as Array<{ id: number; name: string }>);
      const p = presets.find((x) => x.name.trim().toLowerCase() === "grundstellung");
      if (p) home = { kind: "preset", id: p.id };
    }
    if (!home) {
      this.d.log(`Kamera ${cam.name}: keine Grundstellung (Wachposition oder Preset „Grundstellung“) – folgt nicht`);
      this.d.count("follow", "no_home", { cam: cam.name });
    }
    this.homes.set(cam.id, { home, at: now });
    return home;
  }

  private async runCloseUp(cam: MotionCam): Promise<CloseUp | null> {
    const st = this.state(cam.id);
    const t0 = this.d.now();
    if (closeUpBlocked(st, t0, cam, this.d.vehicleActive(cam.id))) return null;
    st.closeUp = true;
    st.abort = null;
    st.lastCloseUpAt = t0;
    const deadline = cam.zone ? t0 + CLOSEUP_ZONE_MAX_MS : Number.POSITIVE_INFINITY;
    const aborted = () => st.abort === "hand" || (st.abort === "vehicle" && cam.zone) || this.d.now() >= deadline;
    let moved = false;
    try {
      // Schwenk-Kamera: erst die Person in die Mitte holen lassen.
      if (cam.pan && !st.following) await this.startFollow(cam);
      let boxes = await this.d.persons(await this.d.snap(cam.id));
      if (st.following) {
        const until = this.d.now() + CENTER_WAIT_MS;
        while (boxes?.length && !isCentered(largestBox(boxes)!) && this.d.now() < until && !aborted()) {
          await this.d.sleep(1_000);
          boxes = await this.d.persons(await this.d.snap(cam.id));
        }
      }
      if (!boxes?.length || aborted()) return null;
      const zoom = await this.d.readZoom(cam.id);
      const factor = opticalFactor(cam.model);
      const plan = planCloseUp(boxes, zoom, factor);
      if (!plan) {
        this.d.count("camera", "closeup_skip", { cam: cam.name });
        return null;
      }
      this.zoomHomes.set(cam.id, zoom.pos);
      await this.persist();
      st.lastMovedAt = this.d.now();
      await this.d.writeZoom(cam.id, plan.pos);
      moved = true;
      const shot = async (): Promise<{ jpeg: Buffer; boxes: NormBox[] } | null> => {
        await this.d.sleep(Math.max(0, Math.min(FOCUS_MS, deadline - this.d.now() - 1_000)));
        if (aborted()) return null;
        const jpeg = await this.d.snap(cam.id);
        const found = await this.d.persons(jpeg);
        return found?.length ? { jpeg, boxes: found } : null;
      };
      let gain = plan.gain;
      let got = await shot();
      if (!got && !cam.zone && !aborted()) {
        gain = 1 + (plan.gain - 1) / 2;
        await this.d.writeZoom(cam.id, posForMagnification(plan.from * gain, zoom.min, zoom.max, factor));
        got = await shot();
      }
      if (!got) {
        this.d.count("camera", aborted() ? "closeup_abort" : "closeup_lost", { cam: cam.name });
        return null;
      }
      const before = largestBox(boxes)!;
      const after = largestBox(got.boxes)!;
      this.d.count("camera", "zoom_ratio", {
        cam: cam.name,
        model: cam.model,
        pos: plan.pos,
        expected: Number(gain.toFixed(2)),
        measured: Number((after.h / before.h).toFixed(2)),
      });
      return { jpeg: got.jpeg, at: this.d.now(), gain, persons: got.boxes.length };
    } finally {
      const home = this.zoomHomes.get(cam.id);
      if (moved && home != null && st.abort !== "hand") {
        await this.d.writeZoom(cam.id, home).catch((e) => this.fail(`${cam.name}: Zoom zurück`, e));
      }
      this.zoomHomes.delete(cam.id);
      st.closeUp = false;
      st.abort = null;
      st.homeAt = this.d.now();
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    const moves: PersistedMove[] = [];
    for (const [id, st] of this.states) {
      const zoomHome = this.zoomHomes.get(id) ?? null;
      if (st.following || zoomHome != null) {
        moves.push({ cameraId: id, following: st.following, trackKey: this.trackKeys.get(id) ?? null, zoomHome });
      }
    }
    await this.d.save(moves).catch((e) => this.fail("Zustand speichern", e));
  }
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `node --import tsx --test hub/src/camera-motion.test.ts hub/src/camera-motion-rules.test.ts`
Expected: PASS, 31 Tests.

- [ ] **Step 5: Typprüfung und Commit**

Run: `./node_modules/.bin/tsc -p hub/tsconfig.json`
Expected: keine Ausgabe.

```bash
git add hub/src/camera-motion.ts hub/src/camera-motion.test.ts
git commit -m "Hub: Koordinator für Folgen und optische Nahaufnahme mit Grundstellung, Vorrang und Wiederherstellung"
```

---

### Task 4: Reolink-Treiber und Anbindung in `cameras.ts`, `tasks.ts`, `index.ts`, `improve-log.ts`

**Files:**
- Modify: `hub/src/cameras.ts` (Importe; Treiber und Exporte nach `getMotionDiagnostics`; `readAutoTrack`; `cameraScene`; `pollCameras`; Fahrzeug-Burst; Gesichtserkennung)
- Modify: `hub/src/parking.ts` (Export `parkingCameraHosts`)
- Modify: `hub/src/tasks.ts` (Hand)
- Modify: `hub/src/index.ts` (Wiederherstellung)
- Modify: `hub/src/improve-log.ts` (Art `follow`, Hinweise)

**Interfaces:**
- Consumes: `CameraMotion`, `MotionDriver`, `PersistedMove`, `CloseUp` (Task 3); `RULE_HOLD_MS`, `isZoneCamera`, `readTrackingCfg` (Task 2); `detectPersons` aus `person-crop.ts`.
- Produces (Exporte aus `cameras.ts`): `personCloseUp(cameraId): Promise<CloseUp | null>`, `cameraAtHome(cameraId): boolean`, `waitCameraAtHome(cameraId, maxMs): Promise<boolean>`, `cameraFollowing(cameraId): boolean`, `noteCameraHand(cameraId): void`, `restoreCameraMotion(): Promise<void>`, `cameraIdByHost(host): number | null`. Aus `parking.ts`: `parkingCameraHosts(): Promise<Set<string>>`.

- [ ] **Step 1: `improve-log.ts` – Art `follow` und Hinweise**

`ImproveKind` um `| "follow"` ergänzen (nach `"camera"`). In `hints()` vor `if (out.length === 0)` einfügen:

```ts
  if (n("follow.home_fail") >= 1) {
    out.push("Schwenk-Kamera fand nach dem Folgen nicht in die Grundstellung – Wachposition prüfen");
  }
  if (n("follow.no_home") >= 1) {
    out.push("Schwenk-Kamera ohne Grundstellung folgt nicht – Wachposition setzen oder Preset „Grundstellung“ anlegen");
  }
```

- [ ] **Step 2: `parking.ts` – Hosts der Parkkameras**

Nach `parkingSetup` einfügen:

```ts
let parkingHostsCache: { at: number; hosts: Set<string> } | null = null;

/** IPs der Kameras mit Parkflaeche (Kiosk-Konfiguration) – fester Bildausschnitt. */
export async function parkingCameraHosts(): Promise<Set<string>> {
  if (parkingHostsCache && Date.now() - parkingHostsCache.at < 60_000) return parkingHostsCache.hosts;
  const cfg = await loadKioskConfig();
  const cams = cfg && Array.isArray(cfg.cams) ? cfg.cams : [];
  const hosts = new Set(cams.filter((c) => parkingSetup(c)).map((c) => String(c.ip ?? "").trim()).filter(Boolean));
  parkingHostsCache = { at: Date.now(), hosts };
  return hosts;
}
```

- [ ] **Step 3: `cameras.ts` – Importe**

```ts
import { detectPersons, faceViaZoom } from "./person-crop.js";
import { CameraMotion, type CloseUp, type MotionDriver, type PersistedMove } from "./camera-motion.js";
import { RULE_HOLD_MS, isZoneCamera, readTrackingCfg } from "./camera-motion-rules.js";
```

(Die bestehende Zeile `import { faceViaZoom } from "./person-crop.js";` ersetzen.)

- [ ] **Step 4: `cameras.ts` – Treiber und Exporte direkt nach `getMotionDiagnostics`**

```ts
/* ---------------------------------------------------------------------------
 * Personen: Folgen und optische Nahaufnahme (camera-motion.ts)
 * ------------------------------------------------------------------------- */

const MOTION_FILE = path.join(CONFIG.hubDir, ".cache", "camera-motion.json");
const flagOn = (v: string | undefined) => !/^(0|false|off|nein)$/i.test((v ?? "").trim());

const motionDriver: MotionDriver = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms))),
  async camera(id) {
    const cam = cameras.get(id);
    if (!cam) return null;
    const caps = await getCameraCaps(id).catch(() => null);
    if (!caps) return null;
    const { parkingCameraHosts } = await import("./parking.js");
    const hosts = await parkingCameraHosts().catch(() => new Set<string>());
    return { id, name: cam.config.name, model: caps.model, pan: caps.pan, zoom: caps.zoom, zone: isZoneCamera(cam.config, hosts) };
  },
  async readZoom(id) {
    const cam = await getControlCam(id);
    return ptzSerial(id, () => readZoom(cam));
  },
  async writeZoom(id, pos) {
    const cam = await getControlCam(id);
    await ptzSerial(id, () => writeZoom(cam, pos));
  },
  async readTracking(id) {
    const cam = await getControlCam(id);
    await ensureLogin(cam);
    return cgi(cam, "GetAiCfg", { channel: cam.config.channel });
  },
  async writeTracking(id, patch) {
    const cam = await getControlCam(id);
    await ptzSerial(id, async () => {
      await ensureLogin(cam);
      await cgi(cam, "SetAiCfg", { channel: cam.config.channel, ...patch });
    });
  },
  async readGuard(id) {
    const cam = await getControlCam(id);
    await ensureLogin(cam);
    const value = await cgi(cam, "GetPtzGuard", { channel: cam.config.channel }).catch(() => null);
    const g = value?.PtzGuard as { bexistPos?: number } | undefined;
    return { supported: !!g, exists: g?.bexistPos === 1 };
  },
  async guard(id, cmd) {
    const cam = await getControlCam(id);
    await ptzSerial(id, async () => {
      await ensureLogin(cam);
      await cgi(cam, "SetPtzGuard", {
        PtzGuard: { channel: cam.config.channel, cmdStr: cmd, ...(cmd === "setPos" ? { bSaveCurrentPos: 1 } : {}) },
      });
    });
  },
  async presets(id) {
    return ((await getPtzPresets(id)) as { presets: Array<{ id: number; name: string }> }).presets;
  },
  async gotoPreset(id, presetId) {
    const cam = await getControlCam(id);
    await ptzSerial(id, async () => {
      await ensureLogin(cam);
      await cgi(cam, "PtzCtrl", { channel: cam.config.channel, op: "ToPos", id: presetId, speed: 48 });
    });
  },
  async snap(id) {
    return captureSnap(await getControlCam(id));
  },
  persons: (jpeg) => detectPersons(jpeg),
  vehicleActive: (id) => cameras.get(id)?.states.VEHICLE === true,
  async save(moves) {
    await fs.mkdir(path.dirname(MOTION_FILE), { recursive: true });
    await fs.writeFile(MOTION_FILE, JSON.stringify(moves));
  },
  async load() {
    const raw = await fs.readFile(MOTION_FILE, "utf8").catch(() => "[]");
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as PersistedMove[]) : [];
  },
  log,
  count: (kind, event, data) => improve(kind, event, data),
};

const motion = new CameraMotion(motionDriver, {
  follow: flagOn(process.env.HUB_CAMERA_AUTOFOLLOW),
  zoom: flagOn(process.env.HUB_CAMERA_AUTOZOOM),
});

/** Optische Nahaufnahme fuer Gesichtserkennung und Waechter (null = digital weiter). */
export function personCloseUp(cameraId: number): Promise<CloseUp | null> {
  return motion.closeUp(cameraId);
}

/** Kamera steht in Grundstellung (Zonen-Auswertungen). */
export function cameraAtHome(cameraId: number): boolean {
  return motion.atHome(cameraId);
}

export function waitCameraAtHome(cameraId: number, maxMs: number): Promise<boolean> {
  return motion.waitAtHome(cameraId, maxMs);
}

export function cameraFollowing(cameraId: number): boolean {
  return motion.isFollowing(cameraId);
}

/** Handsteuerung aus Zentrale, Cloud oder Assistent: Automatik haelt 5 min still. */
export function noteCameraHand(cameraId: number): void {
  void motion.noteHand(cameraId);
}

/** Beim Hub-Start: von einem Neustart unterbrochene Bewegungen zurueckstellen. */
export function restoreCameraMotion(): Promise<void> {
  return motion.restore();
}

/** Kamera-Id zu einer IP (Kiosk-Konfiguration der Parkflaeche). */
export function cameraIdByHost(host: string): number | null {
  for (const cam of cameras.values()) if (cam.config.host === host) return cam.config.id;
  return null;
}
```

- [ ] **Step 5: `cameras.ts` – `readAutoTrack` auf `readTrackingCfg` umstellen**

```ts
/** Schalter in Get/SetAiCfg (readTrackingCfg): `bSmartTrack`, sonst `aiTrack`. */
async function readAutoTrack(cam: CameraRuntime): Promise<{ key: string; on: boolean }> {
  await ensureLogin(cam);
  const t = readTrackingCfg(await cgi(cam, "GetAiCfg", { channel: cam.config.channel }));
  if (!t) throw new Error("Kamera kann nicht automatisch folgen (kein Auto-Tracking in GetAiCfg)");
  return { key: t.key, on: t.on };
}
```

- [ ] **Step 6: `cameras.ts` – `cameraScene` meldet die Regel**

Direkt nach `if (presetId == null && autoTrack == null) throw new Error("Weder Preset noch Folgen angegeben");`:

```ts
  // Die Regel bewegt die Kamera: Automatik haelt still, bis sie zurueck ist.
  motion.noteRule(cameraId, returnAfter > 0 ? returnAfter * 1000 + SCENE_SETTLE_MS + 5_000 : RULE_HOLD_MS);
```

- [ ] **Step 7: `cameras.ts` – Flanken in `pollOne` und Takt in `pollCameras`**

Im Flanken-Block `if (active && !was) {` als erste Zeilen:

```ts
            if (type === "PERSON") {
              void motion
                .onPersonStart(cam.config.id)
                .catch((e) => log(`Kamera ${cam.config.name}: Folgen: ${e instanceof Error ? e.message : e}`));
            } else if (type === "VEHICLE") {
              motion.onVehicleStart(cam.config.id);
            }
```

In der Schleife über `debounceEvents(...)` als erste Zeilen:

```ts
          if (ev.type === "PERSON" && ev.phase === "end") {
            void motion
              .onPersonEnd(cam.config.id)
              .catch((e) => log(`Kamera ${cam.config.name}: Folgen beenden: ${e instanceof Error ? e.message : e}`));
          }
```

Vor `const openEvents = ...`:

```ts
    void motion.tick().catch((e) => log(`Kamera-Bewegung: ${e instanceof Error ? e.message : e}`));
```

- [ ] **Step 8: `cameras.ts` – Fahrzeug-Burst wartet kurz auf die Grundstellung**

Am Anfang von `uploadVehicleSnapshotBody`, vor `await new Promise((r) => setTimeout(r, VEHICLE_SNAP_DELAY_MS));`:

```ts
  // Laeuft noch eine Nahaufnahme (Waechter), passen Zone und Mindestgroesse nicht.
  if (!motion.atHome(cameraId)) await motion.waitAtHome(cameraId, 3_000);
```

- [ ] **Step 9: `cameras.ts` – Gesichtserkennung nutzt die optische Nahaufnahme**

Den Block ab `// Digitaler Zoom: Gesicht zu klein oder ohne Treffer` bis zur schließenden Klammer von `if (buf) { ... }` ersetzen durch:

```ts
  // Gesicht zu klein oder ohne Treffer: erst optisch heranzoomen (Kamera mit
  // Zoom-Objektiv), sonst Kopf-Ausschnitte digital vergroessern.
  let optical = false;
  if (buf) {
    await refreshGallery();
    const direct = face ? scoreGallery(face.embedding, { upscaled: face.upscaled }).match : null;
    if (!direct) {
      const close = await motion.closeUp(cameraId).catch(() => null);
      if (close) {
        improve("face", "optical", { cam: cam.config.name, gain: Number(close.gain.toFixed(2)), persons: close.persons });
        const got = (await embedJpeg(close.jpeg)) ?? (await faceViaZoom(close.jpeg).catch(() => null))?.face ?? null;
        if (got) {
          log(`Personen-Snapshot ${cam.config.name}: Gesicht über optischen Zoom ×${close.gain.toFixed(1)}`);
          improve("face", "optical_face", { cam: cam.config.name, upscaled: got.upscaled });
          face = got;
          buf = close.jpeg;
          optical = true;
        }
      }
      if (!optical) {
        const z = await faceViaZoom(buf).catch(() => null);
        if (z && (z.matched || !face)) {
          log(`Personen-Snapshot ${cam.config.name}: Gesicht über digitalen Zoom${z.matched ? " (Treffer)" : ""}, ${z.persons} Person(en) im Bild`);
          improve("face", z.matched ? "zoom_match" : "zoom_face", { cam: cam.config.name, persons: z.persons });
          face = z.face;
        }
      }
    }
  }
```

Nach `const match = scored.match;` einfügen:

```ts
  if (match && optical) improve("face", "optical_match", { cam: cam.config.name, score: match.score });
```

- [ ] **Step 10: `tasks.ts` – Handsteuerung melden**

Import um `noteCameraHand` ergänzen. Im inneren `switch`:

```ts
          case "CAMERA_PTZ":
            noteCameraHand(cameraId);
            result = await ptzControl(cameraId, task.payload);
            break;
```

```ts
          case "CAMERA_ZOOM":
            // Nur Fahren ist Handsteuerung, Lesen (ohne pos/step) nicht.
            if (task.payload?.pos != null || task.payload?.step != null) noteCameraHand(cameraId);
            result = { zoom: await cameraZoom(cameraId, task.payload) };
            break;
```

- [ ] **Step 11: `index.ts` – Wiederherstellung beim Start**

Import: `import { pollCameras, CAMERA_POLL_INTERVAL_MS, restoreCameraMotion } from "./cameras.js";`. Vor `setInterval(pollCameras, CAMERA_POLL_INTERVAL_MS);`:

```ts
// Folgen/Nahaufnahme, die ein Neustart unterbrochen hat: Kameras zurueckstellen.
void restoreCameraMotion();
```

- [ ] **Step 12: Prüfen**

Run: `./node_modules/.bin/tsc -p hub/tsconfig.json && npm test 2>&1 | tail -8`
Expected: kein tsc-Fehler, `pass 321`, `fail 0`.

- [ ] **Step 13: Commit**

```bash
git add hub/src/cameras.ts hub/src/parking.ts hub/src/tasks.ts hub/src/index.ts hub/src/improve-log.ts
git commit -m "Hub: Kameras folgen Personen ab dem ersten Signal, Gesichtserkennung nutzt den optischen Zoom"
```

---

### Task 5: Wächter auf die gemeinsame Nahaufnahme umstellen

**Files:**
- Modify: `hub/src/agent/sentinel.ts`

**Interfaces:**
- Consumes: `personCloseUp`, `cameraFollowing` aus `cameras.ts` (Task 4).

- [ ] **Step 1: Kopfkommentar anpassen**

```ts
 * Ohne Rueckfrage (harmlos, stellt sich selbst zurueck):
 *  - Schwenk-Kameras folgen Personen schon ab dem ersten Signal
 *    (camera-motion.ts), nicht erst nach dem Alarm.
 *  - Bildserie: drei Standbilder im Abstand von 4 s.
 * Personen: optische Nahaufnahme (personCloseUp, gemeinsam mit der
 * Gesichtserkennung), sonst digitaler Ausschnitt; bewerten und
```

(ersetzt die Zeilen ab „Ohne Rueckfrage“ bis „Personen: heranzoomen (Zoom-Objektiv, PTZ folgt), Nahaufnahme bewerten und“).

- [ ] **Step 2: Import und Konstanten**

```ts
import { captureSnapshot, cameraFollowing, findCameraByRef, getCameraCaps, personCloseUp } from "../cameras.js";
```

`const FOLLOW_SECONDS = 180;` und die Funktion `closeUp(...)` samt Kommentar löschen.

- [ ] **Step 3: Eigenes Folgen entfernen**

Ersetzen:

```ts
  // Automatisch: PTZ folgen lassen (stellt sich nach 3 min selbst zurueck).
  const caps = isDoorbird(cam.id) ? null : await getCameraCaps(cam.id).catch(() => null);
  let followed = false;
  const follow = async () => {
    if (!caps?.pan || followed) return;
    try {
      await cameraScene(cam.id, { autoTrack: true, returnAfterSeconds: FOLLOW_SECONDS });
      followed = true;
    } catch (e) {
      log(`Wächter: ${cam.name}: Folgen fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    }
  };
```

durch:

```ts
  const caps = isDoorbird(cam.id) ? null : await getCameraCaps(cam.id).catch(() => null);
```

- [ ] **Step 4: Nahaufnahme**

Ersetzen:

```ts
    // Digitaler Zoom auf die gefundenen Personen (Ausschnitt aus dem Vollbild,
    // die Kamera bewegt sich dafuer nicht). Nur ohne Boxen optisch zoomen.
    if (boxes?.length) {
      close = await groupCrop(first, boxes);
      log(`Wächter: ${cam.name}: digitaler Zoom auf ${boxes.length} Person(en)${close ? "" : " (Ausschnitt lohnt nicht)"}`);
    } else {
      close = await closeUp(cam.id, caps).catch((e) => {
        log(`Wächter: ${cam.name}: Heranzoomen fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
        return null;
      });
    }
```

durch:

```ts
    // Nahaufnahme: optisch, wenn die Kamera ein Zoom-Objektiv hat, sonst
    // digitaler Ausschnitt um die gefundenen Personen.
    if (boxes?.length) {
      const optical = isDoorbird(cam.id) ? null : await personCloseUp(cam.id).catch(() => null);
      close = optical?.jpeg ?? (await groupCrop(first, boxes));
      log(
        `Wächter: ${cam.name}: ${optical ? `optischer Zoom ×${optical.gain.toFixed(1)}` : "digitaler Zoom"} auf ${boxes.length} Person(en)` +
          (close ? "" : " (Ausschnitt lohnt nicht)")
      );
    }
```

- [ ] **Step 5: Meldung**

`await follow();` (nach `recordHubEvent(... "Assistent: auffällig" ...)`) ersetzen durch:

```ts
  const followed = cameraFollowing(cam.id);
```

In der Bildunterschrift `(followed ? `\nKamera folgt ${FOLLOW_SECONDS / 60} Minuten.` : "")` ersetzen durch `(followed ? "\nKamera folgt der Person." : "")`.

- [ ] **Step 6: Prüfen**

Run: `./node_modules/.bin/tsc -p hub/tsconfig.json && npm test 2>&1 | tail -8`
Expected: kein tsc-Fehler (insbesondere keine unbenutzten Importe von `cameraScene`/`cameraZoom`/`CameraCaps`), `pass 321`.

- [ ] **Step 7: Commit**

```bash
git add hub/src/agent/sentinel.ts
git commit -m "Wächter: optische Nahaufnahme statt Mitte-Zoom, Folgen kommt aus der Kamera-Steuerung"
```

---

### Task 6: Zonen-Auswertungen, Doku, Journal

**Files:**
- Modify: `hub/src/noparking.ts` (`checkCamera`)
- Modify: `hub/src/parking.ts` (`collectParkingSnapshot`)
- Modify: `hub/src/occupancy.ts` (`countCamera`)
- Modify: `hub/README.md:174-176`
- Modify: `hub/IMPROVE.md`, `docs/superpowers/specs/2026-11-06-optischer-zoom-und-folgen-design.md`

**Interfaces:**
- Consumes: `cameraAtHome`, `waitCameraAtHome`, `cameraIdByHost` (Task 4).

- [ ] **Step 1: Halteverbot**

Import in `noparking.ts` um `cameraAtHome` ergänzen. In `checkCamera` nach `missingZoneWarned.delete(cam.id);`:

```ts
  // Kamera zoomt gerade auf eine Person: die Flaeche passt nicht zum Bild.
  // Die Standzeit bleibt erhalten, das naechste Bild zaehlt wieder.
  if (!cameraAtHome(cam.id)) {
    improve("noparking", "skip_moved", { cam: cam.name });
    return;
  }
```

- [ ] **Step 2: Parkfläche**

Import: `import { cameraAtHome, cameraIdByHost, markCameraConfigStale } from "./cameras.js";`. In `collectParkingSnapshot` vor `return (lastSnapshot = {`:

```ts
  const prevLots = new Map(lastSnapshot.lots.map((l) => [l.kioskId, l]));
```

Im `lots.map` die Zählung ersetzen:

```ts
    lots: lotsCfg.map(({ cam, setup }) => {
      const id = String(cam.id ?? "");
      const live = counters[id] ?? {};
      // Kamera zoomt gerade auf eine Person: letzte Zaehlung halten.
      const camId = cameraIdByHost(String(cam.ip ?? "").trim());
      const held = camId != null && !cameraAtHome(camId) ? prevLots.get(id) : undefined;
      return {
        kioskId: id,
        name: String(cam.name ?? id),
        ip: String(cam.ip ?? ""),
        mode: setup.mode,
        count: held ? held.count : Number(live.count ?? 0) || 0,
        lastUpdate: Number(live.lastUpdate ?? 0) || 0,
        lastError: typeof live.lastError === "string" ? live.lastError : null,
        fps: Number(live.fps ?? 0) || 0,
        zone: setup.zone,
      };
    }),
```

- [ ] **Step 3: Belegung**

Import in `occupancy.ts`: `import { captureSnapshot, listCameraConfigs, listCameraStatus, waitCameraAtHome } from "./cameras.js";`. Nach `const HISTORY_MS = ...`:

```ts
/** Kamera folgt oder zoomt: so lange warten, sonst diese Runde ohne sie. */
const MOVED_WAIT_MS = 20_000;
```

Am Anfang von `countCamera` (vor `try`):

```ts
  if (!(await waitCameraAtHome(cam.id, MOVED_WAIT_MS))) {
    return { id: cam.id, name: cam.name, persons: null, error: "Kamera bewegt sich" };
  }
```

- [ ] **Step 4: README**

Zeile 174 (Wächter mit Bildern): „Auffälliges: PTZ-Kamera folgt 3 Minuten automatisch und stellt sich danach zurück, drei Bilder …“ ersetzen durch „Auffälliges: drei Bilder …“.

Zeile 175 (Personen: Mitarbeiter oder nicht?): „Bei einer Person zoomt der Wächter heran (Zoom-Objektiv auf ~60 %, PTZ folgt vorher), bewertet die Nahaufnahme“ ersetzen durch „Bei einer Person holt der Wächter eine Nahaufnahme (optisch über `personCloseUp`, sonst digital), bewertet sie“.

Zeile 176 (Digitaler Zoom): letzten Satz ersetzen durch „Gesichtserkennung und Wächter nutzen ihn, wenn die optische Nahaufnahme nicht geht oder nicht lohnt.“

Danach neuen Punkt einfügen:

```markdown
- **Folgen und optische Nahaufnahme** (`camera-motion.ts`, Regeln in `camera-motion-rules.ts`): Schwenk-Kameras (Gastro, Shop, Halle, Übungslift) schalten beim ersten Personen-Signal das Tracking der Kamera ein, höchstens 2 Minuten, dann zurück in die Grundstellung (Wachposition der Kamera, sonst Preset „Grundstellung“) und 1 Minute Pause. Kameras mit Zoom-Objektiv zoomen für Gesichtserkennung und Wächter gezielt heran: Schwenk-Kameras nach dem Zentrieren, reine Zoom-Kameras nur so weit, dass die Person im Bild bleibt (unter 1,3-fach bleibt es digital). Zonen-Kameras (Kennzeichen, Halteverbot, Lieferdienste, Parkfläche) zoomen höchstens 6 s und alle 2 min, folgen nie; Halteverbot, Parkfläche und Belegung warten bzw. halten so lange. Handsteuerung (Zentrale, Cloud, Assistent) bricht ab und sperrt 5 min, Regeln „Kamera steuern“ gehen vor. Laufende Bewegungen stehen in `hub/.cache/camera-motion.json` und werden nach einem Neustart zurückgestellt. Abschalten: `HUB_CAMERA_AUTOFOLLOW=off`, `HUB_CAMERA_AUTOZOOM=off`.
```

- [ ] **Step 5: Spec an die Abweichungen angleichen**

In der Spec: „Das Ergebnis gilt 15 s.“ → „Das Ergebnis gilt 45 s (der Wächter fragt erst nach dem Bildmodell).“; „Halteverbot (`noparking.ts`): Bild auslassen, Standzeit läuft nicht weiter.“ → „Halteverbot (`noparking.ts`): Bild auslassen, die Standzeit bleibt erhalten.“; „Belegung (`occupancy.ts`): Messung dieser Kamera verschieben, bis sie in Grundstellung ist, höchstens bis zur nächsten Runde.“ → „Belegung (`occupancy.ts`): bis 20 s auf die Grundstellung warten, sonst diese Kamera bis zur nächsten Runde auslassen.“; im Abschnitt Tests „Mock-Reolink um … erweitern.“ → „Fake-Treiber in `camera-motion.test.ts` (einen Mock-Reolink gibt es im Repo nicht).“

- [ ] **Step 6: Journal**

An `hub/IMPROVE.md` anhängen (Datum, Befund mit Zahlen aus Task 1, Änderung, nächster Schritt):

```markdown
## 2026-11-06 (Personen: optischer Zoom und Folgen umgesetzt)

### Änderung

- `camera-motion.ts`: Folgen ab der ersten PERSON-Flanke (Gastro, Shop, Halle, Übungslift), höchstens 120 s, dann Wachposition bzw. Preset „Grundstellung“ und 60 s Pause. Hand sperrt 5 min, Regeln gehen vor, Neustart stellt zurück (`.cache/camera-motion.json`).
- Optische Nahaufnahme für Gesichtserkennung und Wächter, gezielt aus den YOLO-Boxen (Schwenk-Kameras nach dem Zentrieren). Zonen-Kameras Eingang und Halle 2: ≤ 6 s, alle 2 min, nie bei Fahrzeug.
- Halteverbot überspringt, Parkfläche hält, Belegung wartet bis 20 s, Fahrzeug-Burst bis 3 s, solange eine Kamera bewegt ist.
- Tracking-Schalter: `bSmartTrack` vor `aiTrack` (auch für die Regel-Aktion).
- Geprüft: `tsc` Hub, `npm test` 321/321 (neu: 31 für Regeln und Abläufe mit Fake-Treiber).

### Nächster Schritt

- Nach dem Deploy: `follow.*`, `face.optical*` und `camera.zoom_ratio` im Snapshot. Ziele nach zwei Tagen: `face.optical_face / face.optical` ≥ 50 %, mehr Gesichter optisch als digital, `follow.end_gone` > `follow.end_max`, `follow.home_fail` = 0.
- `camera.zoom_ratio` (erwartet gegen gemessen) je Modell auswerten, Zoomfaktor der RLC-823S1 festlegen.
- Live ansehen: Übungslift folgt einer Person und kehrt zurück, Eingang zoomt kurz ohne Halteverbots-Fehlmeldung.
```

- [ ] **Step 7: Prüfen und Commit**

Run: `./node_modules/.bin/tsc -p hub/tsconfig.json && npm test 2>&1 | tail -8`
Expected: kein tsc-Fehler, `pass 321`, `fail 0`.

```bash
git add hub/src/noparking.ts hub/src/parking.ts hub/src/occupancy.ts hub/README.md hub/IMPROVE.md docs/superpowers/specs/2026-11-06-optischer-zoom-und-folgen-design.md
git commit -m "Hub: Zonen-Auswertungen warten auf die Grundstellung, Doku und Journal zu Folgen und Nahaufnahme"
```

- [ ] **Step 8: Deploy nur nach Rückfrage**

Push startet bewegte Kameras im Betrieb. Aaron fragen, dann `git push`.
