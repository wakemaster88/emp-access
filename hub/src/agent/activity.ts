/**
 * KI-Protokoll fuer die Kachel „KI“ in der Zentrale: was der Hub-Assistent
 * gerade tut und getan hat (Waechter-Bewertungen, Erkennungen, Warnungen,
 * Vorschlaege, Aktionen, Telegram-Nachrichten), wie ein Chatverlauf.
 *
 * Nur im Speicher plus kleine Sicherung in hub/.cache (letzte 200 Eintraege,
 * Bilder als verkleinerte JPEGs, die neuesten 40).
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG, log } from "../config.js";
import { shrinkJpeg } from "../image.js";
import { classifyText, clipText, isDuplicate, type ActivityEntry, type ActivityKind } from "./activity-rules.js";

export type { ActivityEntry, ActivityKind } from "./activity-rules.js";

const MAX_ENTRIES = 200;
const MAX_IMAGES = 40;
const THUMB_PX = 640;

const entries: ActivityEntry[] = [];
const images = new Map<number, Buffer>();
let nextId = 1;
let nextImg = 1;
let loading: Promise<void> | null = null;
let saveTimer: NodeJS.Timeout | null = null;
/** Bilder, die noch nicht (oder nur unverkleinert) auf der Platte liegen. */
const dirtyImgs = new Set<number>();

/** Was gerade laeuft (Schluessel → Text), fuer „KI arbeitet …“ in der Kachel. */
const working = new Map<string, { text: string; since: number }>();

function dir(): string {
  return path.join(CONFIG.hubDir, ".cache", "agent-activity");
}

/** Einmal laden; alle Aufrufer warten auf dasselbe Laden (Reihenfolge bleibt). */
function load(): Promise<void> {
  loading ??= loadOnce();
  return loading;
}

async function loadOnce(): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(path.join(dir(), "log.json"), "utf8")) as { entries?: ActivityEntry[]; nextImg?: number };
    const list = Array.isArray(raw.entries) ? raw.entries.slice(-MAX_ENTRIES) : [];
    entries.unshift(...list);
    nextId = Math.max(nextId, ...entries.map((e) => e.id + 1));
    nextImg = Math.max(nextImg, Number(raw.nextImg) || 1);
    for (const f of await readdir(dir())) {
      const m = f.match(/^(\d+)\.jpg$/);
      if (m && entries.some((e) => e.img === Number(m[1]))) images.set(Number(m[1]), await readFile(path.join(dir(), f)));
    }
  } catch {
    /* noch nichts gespeichert */
  }
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void save().catch((e) => log(`KI-Protokoll: Speichern fehlgeschlagen: ${e instanceof Error ? e.message : e}`));
  }, 3_000);
}

async function save(): Promise<void> {
  await mkdir(dir(), { recursive: true });
  await writeFile(path.join(dir(), "log.json"), JSON.stringify({ entries, nextImg }), "utf8");
  const keep = new Set(images.keys());
  for (const f of await readdir(dir())) {
    const m = f.match(/^(\d+)\.jpg$/);
    if (m && !keep.has(Number(m[1]))) await rm(path.join(dir(), f), { force: true });
  }
  for (const id of [...dirtyImgs]) {
    dirtyImgs.delete(id);
    const buf = images.get(id);
    if (buf) await writeFile(path.join(dir(), `${id}.jpg`), buf).catch(() => undefined);
  }
}

export interface RecordInput {
  kind: ActivityKind;
  text: string;
  where?: string;
  telegram?: boolean;
  jpeg?: Buffer | null;
}

/** Eintrag anlegen. Doppelte (gleicher Text an mehrere Chats) werden zusammengefasst. */
export function recordActivity(input: RecordInput): void {
  void load().then(() => recordNow(input)).catch(() => undefined);
}

async function recordNow(input: RecordInput): Promise<void> {
  const text = clipText(input.text);
  if (!text) return;
  const now = Date.now();
  if (isDuplicate(entries, input.kind, text, now)) return;
  const e: ActivityEntry = { id: nextId++, at: new Date(now).toISOString(), kind: input.kind, text };
  if (input.where) e.where = input.where;
  if (input.telegram) e.telegram = true;
  entries.push(e);
  if (input.jpeg?.length) {
    const id = nextImg++;
    e.img = id;
    images.set(id, input.jpeg);
    dirtyImgs.add(id);
    // Verkleinern im Hintergrund; bis dahin liefert die Kachel das Original.
    void shrinkJpeg(input.jpeg, THUMB_PX)
      .then((small) => {
        if (!images.has(id)) return;
        images.set(id, small);
        dirtyImgs.add(id);
      })
      .then(scheduleSave)
      .catch(() => undefined);
    while (images.size > MAX_IMAGES) images.delete(images.keys().next().value as number);
  }
  while (entries.length > MAX_ENTRIES) entries.shift();
  scheduleSave();
}

/** Ausgehende Telegram-Nachricht (aus telegram.ts). */
export function recordTelegramOut(text: string, opts: { buttons?: boolean; jpeg?: Buffer } = {}): void {
  recordActivity({ kind: classifyText(text, opts.buttons), text, telegram: true, jpeg: opts.jpeg });
}

/** Laufende Arbeit an- und abmelden. */
export function beginWork(key: string, text: string): void {
  working.set(key, { text, since: Date.now() });
}

export function endWork(key: string): void {
  working.delete(key);
}

export async function activityPayload(since = 0): Promise<{
  entries: ActivityEntry[];
  working: Array<{ text: string; since: string }>;
  last: number;
}> {
  await load();
  const now = Date.now();
  // Haengengebliebenes nach 5 Minuten verwerfen.
  for (const [k, w] of working) if (now - w.since > 5 * 60_000) working.delete(k);
  return {
    entries: (since > 0 ? entries.filter((e) => e.id > since) : entries.slice(-80)).map((e) =>
      e.img && !images.has(e.img) ? { ...e, img: undefined } : e
    ),
    working: [...working.values()].map((w) => ({ text: w.text, since: new Date(w.since).toISOString() })),
    last: entries.length ? entries[entries.length - 1].id : 0,
  };
}

export async function activityImage(id: number): Promise<Buffer | null> {
  await load();
  return images.get(id) ?? null;
}
