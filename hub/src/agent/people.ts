/**
 * Signale fuer „Person auf dem Gelaende – Mitarbeiter?“:
 *  - Gesichts-Treffer der bestehenden Gesichtserkennung (Hub-Ereignis
 *    kind "person", Liste WHITELIST/BLACKLIST) je Kamera, mit Score und der
 *    Angabe, ob das Gesicht hochgerechnet wurde. Gemerkt werden alle Treffer
 *    der letzten Minuten; welcher fuer eine Bewertung zaehlt, entscheidet
 *    pickFaceHit (sentinel-rules.ts).
 *  - Eingestempelte Mitarbeiter aus emp-control (hub/src/staff.ts, kommt aus
 *    einem eigenen Modul; solange es fehlt, gibt es keine Stempeldaten).
 */
import path from "node:path";
import { randomBytes } from "node:crypto";
import { CONFIG, log } from "../config.js";
import type { HubEvent } from "../state.js";
import {
  CLEAR_MS,
  afterAlarm,
  afterNoAlarm,
  afterOk,
  pruneCleared,
  type ClearedPerson,
  type PendingOk,
  type Sighting,
  type SightingResult,
} from "./people-rules.js";
import { readPeopleFile, writePeopleFile } from "./people-store.js";
import { pickFaceHit, type FaceHit, type TimedFaceHit } from "./sentinel-rules.js";

export type { ClearedPerson } from "./people-rules.js";

/** Stempeldaten aelter als das gelten als unbekannt. */
const STAFF_MAX_AGE_MS = 20 * 60_000;
/** So lange bleiben Gesichts-Treffer je Kamera gemerkt (laenger als jede Bewertung dauert). */
const HIT_KEEP_MS = 10 * 60_000;
/** Hoechstens so viele Treffer je Kamera (die juengsten). */
const HIT_MAX = 20;

const faceHits = new Map<string, TimedFaceHit[]>();
/**
 * Letztes Gesichts-Ereignis je Kamera, mit oder ohne Treffer. Nur ein Beleg,
 * dass dort jemand war (Tracker-Gegencheck, trackerVeto), nie eine Freigabe.
 */
const faceSeen = new Map<string, number>();

export function notePersonEvents(events: HubEvent[]): void {
  const now = Date.now();
  for (const ev of events) {
    if (ev.kind === "person" && ev.where) faceSeen.set(ev.where, now);
    if (ev.kind !== "person" || !ev.where || !ev.list) continue;
    const name = ev.title.replace(/^Person erkannt:\s*/, "").trim();
    const hit: TimedFaceHit = {
      at: now,
      name,
      list: ev.list,
      // Ereignisse eines aelteren Stands haben kein `upscaled`: Der Treffer gilt dann als schwach.
      score: typeof ev.score === "number" && Number.isFinite(ev.score) ? ev.score : undefined,
      upscaled: typeof ev.upscaled === "boolean" ? ev.upscaled : undefined,
    };
    const kept = (faceHits.get(ev.where) ?? []).filter((h) => now - h.at < HIT_KEEP_MS);
    kept.push(hit);
    faceHits.set(ev.where, kept.slice(-HIT_MAX));
  }
}

/**
 * Gesichts-Treffer fuer einen Ausloeser an der Kamera bis jetzt: Whitelist ab
 * 10 s vor `since`, Sperrliste ab 90 s; ein Treffer der Sperrliste gewinnt
 * (pickFaceHit).
 */
export function faceAt(cameraName: string, since: number): FaceHit | null {
  return pickFaceHit(faceHits.get(cameraName) ?? [], since);
}

/** Zeitpunkt des letzten Gesichts-Ereignisses an der Kamera (bekannt oder unbekannt); null = keins seit dem Start. */
export function faceSeenAt(cameraName: string): number | null {
  return faceSeen.get(cameraName) ?? null;
}

type StaffModule = {
  clockedInStaff?: () => Array<{ name: string; onBreak?: boolean }>;
  staffDataAge?: () => number | null;
};
let staffMod: StaffModule | null | undefined;

async function loadStaff(): Promise<StaffModule | null> {
  if (staffMod !== undefined) return staffMod;
  // Bewusst ueber eine Variable: das Modul kommt aus einem parallelen PR.
  const spec = "../staff.js";
  try {
    staffMod = (await import(spec)) as StaffModule;
  } catch {
    staffMod = null;
    setTimeout(() => (staffMod = undefined), 10 * 60_000).unref?.();
  }
  return staffMod;
}

/** Namen der eingestempelten Mitarbeiter; null = keine aktuellen Daten. */
export async function staffClockedIn(): Promise<string[] | null> {
  const mod = await loadStaff();
  if (!mod?.clockedInStaff) return null;
  const age = mod.staffDataAge?.() ?? null;
  if (age === null || age > STAFF_MAX_AGE_MS) return null;
  try {
    return mod.clockedInStaff().map((s) => s.name).filter(Boolean);
  } catch {
    return null;
  }
}

/* ------------------------------------- Wiedererkennung ueber Kameras */

/**
 * Merkliste: Personen, die der Waechter heute schon bewertet hat. Gespeichert
 * wird nur eine kurze Kleidungsbeschreibung des Bildmodells, kein Bild und
 * kein Gesichtsmerkmal. Taucht dieselbe Kleidung an einer anderen Kamera auf,
 * gibt es keinen neuen Alarm. Drei Arten von Eintraegen (people-rules.ts):
 *  - freigegeben (Gesichts-Treffer, Knopf „Ist in Ordnung“): 8 Stunden ab der
 *    letzten Sichtung.
 *  - mitarbeiter (vermutlich Mitarbeiter): ebenso, zaehlt aber nicht im
 *    Nachtfenster des Waechters.
 *  - gemeldet (Alarm ging hinaus): 20 Minuten ab dem Alarm, ohne Verlaengerung.
 */
let cleared: ClearedPerson[] = [];
let loading: Promise<void> | null = null;
/** Alarm-Knopf „Ist in Ordnung“: Kleidung der gemeldeten Personen. */
const pendingOk = new Map<string, PendingOk>();

function clearedPath(): string {
  return path.join(CONFIG.hubDir, ".cache", "agent-people.json");
}

/** Text der Eintraege, die der Knopf „Ist in Ordnung“ anlegt. */
const OK_LABEL = "von Aaron freigegeben";

const newId = () => randomBytes(4).toString("hex");
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Einmal je Hub-Lauf lesen; alle Aufrufer warten auf denselben Lesevorgang. */
function loadCleared(): Promise<void> {
  loading ??= readPeopleFile(clearedPath())
    .then(({ store, problem }) => {
      cleared = store.cleared;
      for (const [k, v] of store.pending) pendingOk.set(k, v);
      if (problem) log(`Wächter: Merkliste: ${problem}`);
    })
    .catch((e) => log(`Wächter: Merkliste: ${errText(e)}`));
  return loading;
}

/** Schreibvorgaenge laufen nacheinander: Sie teilen sich die zweite Datei (atomic-file.ts). */
let writeQueue: Promise<void> = Promise.resolve();

/** Liste aufraeumen und speichern. Ein Fehler steht im Log, die Liste im Speicher gilt weiter. */
function saveCleared(): Promise<void> {
  writeQueue = writeQueue
    .then(() => {
      const now = Date.now();
      cleared = pruneCleared(cleared, now);
      for (const [k, v] of pendingOk) if (now - v.at > CLEAR_MS) pendingOk.delete(k);
      return writePeopleFile(clearedPath(), { cleared, pending: [...pendingOk] });
    })
    .catch((e) => log(`Wächter: Merkliste nicht gespeichert: ${errText(e)}`));
  return writeQueue;
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

/** Aktuell gemerkte Personen, aelteste zuerst (Reihenfolge = Nummern im Prompt). */
export async function activeCleared(): Promise<ClearedPerson[]> {
  await loadCleared();
  const now = Date.now();
  return cleared.filter((c) => c.until > now);
}

/** Kurztext fuer Begruendung/Prompt: „Jakob (Übungslift 14:30)“. */
export function clearedTitle(c: ClearedPerson): string {
  return `${c.label} (${c.camera} ${hhmm(c.at)})`;
}

/** Prompt-Zusatz mit der Liste der bekannten Personen. Leer, wenn keine. */
export function knownPrompt(list: ClearedPerson[]): string {
  if (!list.length) return "";
  return (
    " Heute schon gesehen und bewertet (an dieser oder anderen Kameras):" +
    list.map((c, i) => ` ${i + 1}) ${c.label}: ${c.kleidung}`).join(";") +
    '. Prüfe für jede Person im Bild, ob Kleidung und Aussehen eindeutig zu einer dieser Beschreibungen passen. ' +
    'Gib dafür zusätzlich "bekannt": [Nummern der passenden Einträge] und "unbekannt": Anzahl Personen ohne passenden Eintrag an. Im Zweifel gilt eine Person als unbekannt.'
  );
}

/**
 * Nach einer Entscheidung „kein Alarm“: wiedererkannte Eintraege verlaengern,
 * neue Beschreibungen merken (Regeln: afterNoAlarm in people-rules.ts).
 * `matched` sind die wiedererkannten Eintraege.
 */
export async function rememberSeen(
  s: Omit<Sighting, "now" | "matchedIds"> & { matched: ClearedPerson[] },
): Promise<Omit<SightingResult, "entries">> {
  await loadCleared();
  const { matched, ...seen } = s;
  const { entries, ...changes } = afterNoAlarm(cleared, { ...seen, now: Date.now(), matchedIds: matched.map((m) => m.id) }, newId);
  if (changes.extended || changes.promoted || changes.added) {
    cleared = entries;
    await saveCleared();
  }
  return changes;
}

/** Nach einem Alarm: die gemeldeten Personen 20 Minuten merken. */
export async function rememberReported(camera: string, kleidung: string[]): Promise<void> {
  if (!kleidung.length) return;
  await loadCleared();
  cleared = afterAlarm(cleared, { now: Date.now(), camera, kleidung }, newId);
  await saveCleared();
}

/** Knopf „Ist in Ordnung“ fuer einen Alarm vorbereiten. null = nichts zu merken. */
export async function offerPersonOk(camera: string, kleidung: string[]): Promise<string | null> {
  if (!kleidung.length) return null;
  await loadCleared();
  const token = randomBytes(4).toString("hex");
  pendingOk.set(token, { camera, kleidung, at: Date.now() });
  await saveCleared();
  return `pok:${token}`;
}

/** Antwort auf „Ist in Ordnung“. */
export async function answerPersonOk(token: string): Promise<string> {
  await loadCleared();
  const p = pendingOk.get(token);
  if (!p) return "Diese Meldung ist zu alt, da kann ich nichts mehr merken.";
  pendingOk.delete(token);
  cleared = afterOk(cleared, { now: Date.now(), camera: p.camera, kleidung: p.kleidung, label: OK_LABEL }, newId);
  await saveCleared();
  return `Gemerkt: ${p.kleidung.length === 1 ? "diese Person gilt" : `diese ${p.kleidung.length} Personen gelten`} die nächsten 8 Stunden an allen Kameras als unbedenklich.`;
}
