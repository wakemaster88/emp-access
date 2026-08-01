import { promises as fs } from "node:fs";
import path from "node:path";
import type { ScanRow } from "./emp-access-scans";

/**
 * Lokales Archiv der Zutritts-Scans.
 *
 * Die Cloud gibt pro Anfrage nur die letzten 200 Scans heraus, über alle
 * Geräte des Standorts gemeinsam — im Betrieb keine zwei Stunden. Für die
 * Drehkreuz-Kontrolle reicht das nicht: Sie soll auch morgen noch zeigen,
 * welcher Durchgang gestern gedeckt war.
 *
 * Deshalb schreibt der Server jeden Scan, den er ohnehin abruft, in eine
 * Tagesdatei mit — dieselbe Form wie die Durchgänge des Zählers. Gespeichert
 * werden nur die Felder, die schon im Dashboard landen; Geburtsdatum und Foto
 * aus der Cloud bleiben außen vor.
 *
 * Bewusst roh und nicht als fertige Gegenüberstellung: Wenn die Zuordnung
 * später genauer wird, lässt sich die Vergangenheit damit neu auswerten.
 */

const ROOT =
  process.env.WEBCAMS_SCAN_ARCHIVE ??
  path.join(process.cwd(), "logs", "scans");

/** Wie die Durchgangs-Historie des Zählers. 0 = unbegrenzt. */
const RETENTION_DAYS = Number(
  process.env.WEBCAMS_SCAN_ARCHIVE_RETENTION_DAYS ?? 180,
);

function dayOf(ts: number): string {
  const d = new Date(ts);
  // Lokaler Tag, damit die Dateien zu den Tagen des Zählers passen.
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function fileFor(day: string): string {
  return path.join(ROOT, `${day}.jsonl`);
}

/**
 * Zustand am globalen Objekt, nicht am Modul.
 *
 * Next bündelt dieselbe Datei für die Instrumentierung und für die
 * API-Routen getrennt. Als Modulvariablen gäbe es zwei Zwischenspeicher und
 * zwei Schreibketten — und damit doppelte Zeilen im Archiv, sobald das
 * Nachtragen beim Start und ein Abruf gleichzeitig schreiben.
 */
interface ArchiveState {
  /** Bereits abgelegte IDs je Tag — spart das Neulesen bei jedem Abruf. */
  known: Map<string, Set<number>>;
  writeChain: Promise<void>;
}

declare global {
  var __webcams_scan_archive: ArchiveState | undefined;
}

function getState(): ArchiveState {
  globalThis.__webcams_scan_archive ??= {
    known: new Map(),
    writeChain: Promise.resolve(),
  };
  return globalThis.__webcams_scan_archive;
}

async function idsFor(day: string): Promise<Set<number>> {
  const { known } = getState();
  const cached = known.get(day);
  if (cached) return cached;
  const ids = new Set<number>();
  try {
    const raw = await fs.readFile(fileFor(day), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const id = (JSON.parse(line) as ScanRow).id;
        if (typeof id === "number") ids.add(id);
      } catch {
        // Abgeschnittene Zeile — überspringen.
      }
    }
  } catch {
    // Datei gibt es noch nicht.
  }
  known.set(day, ids);
  return ids;
}

/**
 * Legt neue Scans ab. Mehrfach mit denselben Zeilen aufrufbar — was schon
 * im Archiv steht, wird übersprungen.
 */
export async function archiveScans(rows: ScanRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const state = getState();
  let written = 0;
  state.writeChain = state.writeChain.then(async () => {
    try {
      await fs.mkdir(ROOT, { recursive: true });
      const perDay = new Map<string, ScanRow[]>();
      for (const r of rows) {
        const day = dayOf(r.ts);
        const ids = await idsFor(day);
        if (ids.has(r.id)) continue;
        ids.add(r.id);
        const list = perDay.get(day);
        if (list) list.push(r);
        else perDay.set(day, [r]);
      }
      for (const [day, list] of perDay) {
        list.sort((a, b) => a.ts - b.ts);
        await fs.appendFile(
          fileFor(day),
          list.map((r) => JSON.stringify(r)).join("\n") + "\n",
          "utf8",
        );
        written += list.length;
      }
    } catch (e) {
      console.error("[scan-archive] write failed", (e as Error).message);
    }
  });
  await state.writeChain;
  return written;
}

/** Liest die abgelegten Scans ab einem Zeitpunkt, neueste zuerst. */
export async function readScansSince(from: number): Promise<ScanRow[]> {
  // Nach ID entdoppelt: Aus älteren Läufen können noch Doppelzeilen in den
  // Dateien stehen, die sollen die Bilanz nicht verfälschen.
  const byId = new Map<number, ScanRow>();
  const today = new Date();
  for (let back = 0; back < 400; back++) {
    const d = new Date(today);
    d.setDate(d.getDate() - back);
    const day = dayOf(d.getTime());
    // Ein Tag weiter zurück als nötig, weil die Datei nach lokalem Tag
    // geschnitten ist und `from` mitten hineinfallen kann.
    if (day < dayOf(from)) break;
    let raw: string;
    try {
      raw = await fs.readFile(fileFor(day), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as ScanRow;
        if (typeof r.id === "number" && r.ts >= from) byId.set(r.id, r);
      } catch {
        // Abgeschnittene Zeile — überspringen.
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.ts - a.ts);
}

/** Ältester Zeitpunkt, für den überhaupt etwas archiviert ist. */
export async function archiveStart(): Promise<number | null> {
  try {
    const files = (await fs.readdir(ROOT))
      .filter((f) => f.endsWith(".jsonl"))
      .sort();
    for (const f of files) {
      const raw = await fs.readFile(path.join(ROOT, f), "utf8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as ScanRow;
          if (typeof r.ts === "number") return r.ts;
        } catch {
          // weiter
        }
      }
    }
  } catch {
    // Noch kein Archiv.
  }
  return null;
}

export async function cleanupScanArchive(): Promise<number> {
  if (RETENTION_DAYS <= 0) return 0;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const limit = dayOf(cutoff.getTime());
  let removed = 0;
  try {
    for (const f of await fs.readdir(ROOT)) {
      if (!f.endsWith(".jsonl")) continue;
      if (f.slice(0, 10) < limit) {
        await fs.unlink(path.join(ROOT, f)).catch(() => undefined);
        getState().known.delete(f.slice(0, 10));
        removed++;
      }
    }
  } catch {
    // Noch kein Archiv.
  }
  return removed;
}
