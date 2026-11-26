/**
 * Testfaelle zur Fahrt eines Antriebs (Rolltor, Markise): Profil aus dem
 * Geraetestatus und Verriegelung der Fahrtrichtungen. Dieselben Faelle pruefen
 * den Hub (cover-rules.test.ts, `coverDrivePlan`) und die Cloud
 * (src/lib/cover-constants.test.ts, `coverDrivePlan` mit
 * `shellyCoverComponentId`), damit beide gleich fahren. Nur Testdaten.
 */

export type InterlockAction = "open" | "close" | "stop";

export type InterlockPlan =
  | { kind: "cover"; coverId: number; action: InterlockAction }
  | { kind: "relays-stop"; channels: [number, number] }
  | { kind: "relays"; release: number; move: number; runtimeSec: number; pauseMs: number }
  | { kind: "refuse"; error: string };

export interface InterlockCase {
  name: string;
  /** Status des Shellys, wie Gen2 (`Shelly.GetStatus`) oder Gen1 (`/status`) ihn liefert. */
  status: Record<string, unknown>;
  device: { coverUpChannel: number | null; coverDownChannel: number | null; coverRuntimeSec: number | null };
  action: InterlockAction;
  plan: InterlockPlan;
}

const NOT_CONFIGURED =
  "Antrieb ist nicht eingerichtet – für Auf und Zu müssen zwei verschiedene Shelly-Kanäle hinterlegt sein";
const relays = { "switch:0": { output: false }, "switch:1": { output: false } };
const channels = { coverUpChannel: 0, coverDownChannel: 1, coverRuntimeSec: 45 };

export const INTERLOCK_CASES: readonly InterlockCase[] = [
  {
    name: "Cover-Profil (Gen2): Zu ueber cover:0, der Shelly verriegelt selbst",
    status: { "cover:0": { state: "open" }, sys: {} },
    device: { coverUpChannel: null, coverDownChannel: null, coverRuntimeSec: null },
    action: "close",
    plan: { kind: "cover", coverId: 0, action: "close" },
  },
  {
    name: "Cover-Profil mit zwei Antrieben: der kleinste Index",
    status: { "cover:1": { state: "open" }, "cover:0": { state: "closed" } },
    device: channels,
    action: "close",
    plan: { kind: "cover", coverId: 0, action: "close" },
  },
  {
    name: "Gen1 im Roller-Modus: Antrieb 0",
    status: { rollers: [{ state: "stop" }], relays: [] },
    device: channels,
    action: "close",
    plan: { kind: "cover", coverId: 0, action: "close" },
  },
  {
    name: "Zwei Relais: Zu schaltet erst Auf ab, wartet, dann Zu mit Fahrzeit",
    status: relays,
    device: channels,
    action: "close",
    plan: { kind: "relays", release: 0, move: 1, runtimeSec: 45, pauseMs: 500 },
  },
  {
    name: "Zwei Relais: Auf schaltet erst Zu ab",
    status: relays,
    device: channels,
    action: "open",
    plan: { kind: "relays", release: 1, move: 0, runtimeSec: 45, pauseMs: 500 },
  },
  {
    name: "Zwei Relais vertauscht verdrahtet",
    status: relays,
    device: { coverUpChannel: 1, coverDownChannel: 0, coverRuntimeSec: null },
    action: "close",
    plan: { kind: "relays", release: 1, move: 0, runtimeSec: 60, pauseMs: 500 },
  },
  {
    name: "Zwei Relais: Stopp schaltet beide ab",
    status: relays,
    device: channels,
    action: "stop",
    plan: { kind: "relays-stop", channels: [0, 1] },
  },
  {
    name: "Fahrzeit ueber dem Hoechstwert: Standard",
    status: relays,
    device: { coverUpChannel: 0, coverDownChannel: 1, coverRuntimeSec: 900 },
    action: "close",
    plan: { kind: "relays", release: 0, move: 1, runtimeSec: 60, pauseMs: 500 },
  },
  {
    name: "Beide Richtungen auf demselben Kanal: keine Fahrt",
    status: relays,
    device: { coverUpChannel: 0, coverDownChannel: 0, coverRuntimeSec: null },
    action: "close",
    plan: { kind: "refuse", error: NOT_CONFIGURED },
  },
  {
    name: "Kanaele fehlen: keine Fahrt",
    status: relays,
    device: { coverUpChannel: null, coverDownChannel: 1, coverRuntimeSec: null },
    action: "close",
    plan: { kind: "refuse", error: NOT_CONFIGURED },
  },
  {
    name: "Negativer Kanal: keine Fahrt",
    status: relays,
    device: { coverUpChannel: -1, coverDownChannel: 1, coverRuntimeSec: null },
    action: "close",
    plan: { kind: "refuse", error: NOT_CONFIGURED },
  },
  {
    name: "Leeres Roller-Array zaehlt nicht als Cover-Profil",
    status: { rollers: [] },
    device: { coverUpChannel: null, coverDownChannel: null, coverRuntimeSec: null },
    action: "close",
    plan: { kind: "refuse", error: NOT_CONFIGURED },
  },
];
