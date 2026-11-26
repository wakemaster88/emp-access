/**
 * Zustand der Sperre nach abgelehnten Zugangsdaten (Regeln in auth-latch.ts)
 * in hub/.cache/auth-latch.json: Ein Neustart des Hubs hebt die Sperre nicht
 * auf. In der Datei stehen nur Schluessel (Geraet bzw. Adresse),
 * Fingerabdruecke und Zeitpunkte, nie Zugangsdaten. Sie wird in einem Zug
 * ersetzt und ist nur fuer den Hub-Benutzer lesbar.
 *
 * Jede Pruefung wartet auf ready(); danach laufen gate/note ohne Platte, nur
 * eine Aenderung schreibt (nacheinander, im Hintergrund).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG, log } from "./config.js";
import { writeFileAtomic } from "./atomic-file.js";
import { ChangeLog } from "./change-log.js";
import {
  latchGate,
  latchLocked,
  latchNote,
  parseLatchFile,
  probeAllowed,
  probeMarkAfter,
  serializeLatchFile,
  type AuthOutcome,
  type LatchEntry,
  type LatchFile,
  type LatchGate,
  type LatchNote,
} from "./auth-latch.js";

export class AuthLatchStore {
  private state: LatchFile = { devices: new Map(), probes: new Map() };
  private loading: Promise<void> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly failLog = new ChangeLog(60 * 60_000);

  constructor(private readonly file: string) {}

  /** Einmal von der Platte laden; alle weiteren Aufrufe warten nur darauf. */
  ready(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return;
      // Ohne Inhalt der Datei im Log; sie enthaelt ohnehin keine Zugangsdaten.
      const why = e instanceof SyntaxError ? "beschädigt" : ((e as NodeJS.ErrnoException)?.code ?? "nicht lesbar");
      log(`Sperre abgelehnter Zugangsdaten: ${path.basename(this.file)} nicht lesbar (${why}) – beginnt leer`);
      return;
    }
    this.state = parseLatchFile(raw, Date.now());
  }

  private save(): void {
    this.writing = this.writing
      .then(() => writeFileAtomic(this.file, serializeLatchFile(this.state, Date.now()), { mode: 0o600 }))
      .catch((e) => {
        const code = (e as NodeJS.ErrnoException)?.code ?? "unbekannt";
        if (this.failLog.shouldLog("write", code, Date.now())) {
          log(`Sperre abgelehnter Zugangsdaten: ${path.basename(this.file)} nicht gespeichert (${code})`);
        }
      });
  }

  /** Fuer Tests: bis die letzte Aenderung auf der Platte steht. */
  flushed(): Promise<void> {
    return this.writing;
  }

  private setDevice(key: string, next: LatchEntry | null): void {
    const prev = this.state.devices.get(key) ?? null;
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    if (next) this.state.devices.set(key, next);
    else this.state.devices.delete(key);
    this.save();
  }

  /** Vor einem Versuch mit Zugangsdaten (nach ready()). */
  gate(key: string, fp: string, now: number, rev: string | null = null): LatchGate {
    const g = latchGate(this.state.devices.get(key) ?? null, fp, now, rev);
    this.setDevice(key, g.entry);
    return g;
  }

  /** Nach dem Versuch. */
  note(key: string, fp: string, outcome: AuthOutcome, now: number, rev: string | null = null): LatchNote {
    const n = latchNote(this.state.devices.get(key) ?? null, fp, outcome, now, rev);
    this.setDevice(key, n.entry);
    return n;
  }

  /** Ohne etwas zu aendern: Waere ein Versuch jetzt gesperrt? (Der einzelne Versuch bleibt fuer gate.) */
  blocked(key: string, fp: string, now: number, rev: string | null = null): boolean {
    return !latchGate(this.state.devices.get(key) ?? null, fp, now, rev).allow;
  }

  locked(key: string, fp: string, rev: string | null = null): boolean {
    return latchLocked(this.state.devices.get(key) ?? null, fp, rev);
  }

  /** Kamerasuche: darf diese fremde Adresse jetzt gefragt werden? */
  probeAllowed(ip: string, fp: string, now: number): boolean {
    return probeAllowed(this.state.probes.get(ip) ?? null, fp, now);
  }

  noteProbe(ip: string, fp: string, outcome: AuthOutcome, now: number): void {
    this.state.probes.set(ip, probeMarkAfter(this.state.probes.get(ip) ?? null, fp, outcome, now));
    this.save();
  }
}

/** Der eine Zustand des Hubs fuer DoorBird, Shelly und Kamerasuche. */
export const authLatches = new AuthLatchStore(path.join(CONFIG.hubDir, ".cache", "auth-latch.json"));
