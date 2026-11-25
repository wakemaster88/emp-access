/**
 * Zustands-Waechter: eine Pruefung ausfuehren, melden und den Stand ueber
 * Neustarts des Hubs halten.
 *
 * Der Stand (gemeldete Befunde, fuer den Morgen zurueckgestellte Meldungen,
 * Entwarnungen, die noch niemanden erreicht haben) liegt nach jeder Aenderung
 * in einer Datei (.cache/agent-watch.json), in einem Zug ersetzt, und wird
 * beim Start uebernommen: Ein Befund, der schon gemeldet ist, wird nach einem
 * Neustart nicht noch einmal gemeldet; was waehrend des Neustarts in Ordnung
 * kam, bekommt seine Entwarnung. Die Regeln stehen in findings.ts.
 *
 * Ohne Hub-Konfiguration: Befunde, Ruhezeit, Versand, Log und Pfad kommen vom
 * Aufrufer (agent.ts).
 */
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../atomic-file.js";
import {
  WATCH_STATE_MAX_AGE_MS,
  announceLine,
  keepUnsent,
  newWatchState,
  openFindings,
  resolvedLine,
  restoreWatch,
  serializeWatch,
  unnotify,
  watchLogLines,
  watchStep,
  type Finding,
  type ResolvedFinding,
  type WatchState,
} from "./findings.js";

export interface WatchRunnerDeps {
  /** Datei mit dem Stand. */
  file: string;
  /** Befunde von jetzt; `open` sind die Schluessel der schon gemeldeten. */
  collect: (now: number, open: ReadonlySet<string>) => Finding[];
  /** Ist gerade Ruhezeit? */
  quiet: () => boolean;
  /** Zahl der gekoppelten Chats. */
  chats: () => number;
  /** Meldung senden; das Ergebnis kommt, wenn feststeht, ob sie angekommen ist. */
  send: (text: string) => Promise<{ delivered: boolean; rejected: boolean }>;
  log: (line: string) => void;
  /** Eintrag im KI-Protokoll der Zentrale. */
  record: (kind: "alert" | "warn" | "ok", text: string) => void;
  now?: () => number;
  maxAgeMs?: number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class WatchRunner {
  private readonly st: WatchState = newWatchState();
  /** Der zuletzt gespeicherte Stand (ohne Zeitpunkt): Geschrieben wird nur, was sich geaendert hat. */
  private saved = serializeWatch(this.st, 0);
  /** Schreibvorgaenge laufen nacheinander: Sie teilen sich die zweite Datei (atomic-file.ts). */
  private writes: Promise<void> = Promise.resolve();
  /** Das letzte Speichern ist gescheitert (im Log steht eine Zeile je Wechsel). */
  private saveFailed = false;
  /** Meldungen, deren Zustellung noch laeuft. */
  private readonly sending = new Set<Promise<void>>();
  /**
   * Was die laufenden Meldungen melden: Auf der Platte gilt es als noch nicht
   * gemeldet, bis die Zustellung feststeht (persisted()). Endet der Hub
   * vorher, kommt die Meldung nach dem Neustart erneut.
   */
  private readonly inflight = new Map<Promise<void>, { keys: string[]; resolved: ResolvedFinding[] }>();

  constructor(private readonly deps: WatchRunnerDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /** Offene, bereits gemeldete Befunde (fuer /befunde, Tagesbericht und Kurzlage). */
  open(): Finding[] {
    return openFindings(this.st);
  }

  /**
   * Beim Start: den gespeicherten Stand uebernehmen. Eine fehlende Datei
   * heisst: Es gibt noch keinen. Ein Stand, der sich nicht lesen laesst oder
   * aelter als 24 Stunden ist, wird verworfen; der Grund steht im Log.
   */
  async load(): Promise<void> {
    let json: string;
    try {
      json = await readFile(this.deps.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException | null)?.code !== "ENOENT") this.deps.log(`Zustands-Wächter: gespeicherter Stand nicht lesbar (${errText(e)}), beginne ohne gemeldete Befunde`);
      return;
    }
    const now = this.now();
    const restored = restoreWatch(json, now, this.deps.maxAgeMs ?? WATCH_STATE_MAX_AGE_MS);
    if (restored.dropped) {
      this.deps.log(
        `Zustands-Wächter: gespeicherter Stand verworfen (${restored.dropped === "veraltet" ? "älter als 24 Stunden" : "nicht lesbar"}), beginne ohne gemeldete Befunde`
      );
      return;
    }
    this.st.tracked = restored.state.tracked;
    this.st.deferred = restored.state.deferred;
    this.st.unsent = restored.state.unsent;
    this.saved = serializeWatch(this.st, 0);
    if (!this.st.tracked.size && !this.st.unsent.length) return;
    // Zurueckgestellte Meldungen werden als gemeldet gefuehrt (findings.ts); im Log stehen sie fuer sich.
    const open = this.open().length - this.st.deferred.length;
    const age = Math.max(0, Math.round((now - (restored.savedAt ?? now)) / 60_000));
    this.deps.log(
      `Zustands-Wächter: Stand von vor ${age} min übernommen: ${open} ${open === 1 ? "Befund" : "Befunde"} gemeldet` +
        (this.st.deferred.length ? `, ${this.st.deferred.length} für den Morgen zurückgestellt` : "") +
        (this.st.unsent.length ? `, ${this.st.unsent.length} ${this.st.unsent.length === 1 ? "Entwarnung" : "Entwarnungen"} noch zu senden` : "")
    );
  }

  /**
   * Der Stand fuer die Platte: Befunde laufender Meldungen gelten dort als
   * nicht gemeldet, ihre Entwarnungen als noch zu senden.
   */
  private persisted(): WatchState {
    if (this.inflight.size === 0) return this.st;
    const copy: WatchState = {
      tracked: new Map([...this.st.tracked].map(([k, t]) => [k, { ...t }])),
      deferred: [...this.st.deferred],
      unsent: [...this.st.unsent],
    };
    for (const m of this.inflight.values()) {
      unnotify(copy, m.keys);
      keepUnsent(copy, m.resolved);
    }
    return copy;
  }

  /**
   * Stand speichern, wenn er sich geaendert hat. Scheitert das Schreiben, gilt
   * der Stand im Speicher weiter; im Log steht eine Zeile, wenn es scheitert,
   * und eine, wenn es wieder gelingt.
   */
  private save(): Promise<void> {
    const st = this.persisted();
    const body = serializeWatch(st, 0);
    if (body === this.saved) return this.writes;
    this.saved = body;
    const json = serializeWatch(st, this.now());
    this.writes = this.writes
      .then(() => writeFileAtomic(this.deps.file, json))
      .then(() => {
        if (this.saveFailed) this.deps.log("Zustands-Wächter: Stand wird wieder gespeichert");
        this.saveFailed = false;
      })
      .catch((e) => {
        if (!this.saveFailed) this.deps.log(`Zustands-Wächter: Stand nicht gespeichert: ${errText(e)}`);
        this.saveFailed = true;
      });
    return this.writes;
  }

  /**
   * Eine Pruefung: Befunde sammeln, melden, Stand speichern. Jede Meldung
   * steht mit dem Schluessel ihres Befunds im Log. Die Pruefung wartet nicht
   * auf die Zustellung.
   */
  async tick(): Promise<void> {
    const quiet = this.deps.quiet();
    const now = this.now();
    const open = new Set(this.open().map((f) => f.key));
    const step = watchStep(this.st, this.deps.collect(now, open), now, quiet);
    const lines = [...step.announce.map(announceLine), ...step.resolved.map(resolvedLine)];
    const toChats = this.deps.chats() > 0;
    for (const l of watchLogLines(step, toChats)) this.deps.log(l);
    for (const f of step.deferredNow) this.deps.record("warn", `⚠️ ${f.title} (Ruhezeit – Meldung kommt morgens)`);
    if (lines.length && toChats) {
      // Hat die Meldung nach allen Versuchen keinen Chat erreicht, gelten ihre
      // Befunde wieder als nicht gemeldet und kommen bei der naechsten Pruefung
      // erneut, solange sie dann noch bestehen; ihre Entwarnungen kommen
      // ebenfalls erneut. Hat Telegram sie abgelehnt, aendert ein neuer
      // Versuch nichts.
      const keys = step.announce.map((f) => f.key);
      const sending: Promise<void> = Promise.resolve()
        .then(() => this.deps.send(lines.join("\n")))
        .then((sent) => {
          this.inflight.delete(sending);
          if (!sent.delivered && !sent.rejected) {
            unnotify(this.st, keys);
            keepUnsent(this.st, step.resolved);
          }
          return this.save();
        })
        .catch((e) => this.deps.log(`Zustands-Wächter: Meldung: ${errText(e)}`))
        .finally(() => {
          this.inflight.delete(sending);
          this.sending.delete(sending);
        });
      this.inflight.set(sending, { keys, resolved: step.resolved });
      this.sending.add(sending);
    } else {
      for (const l of lines) this.deps.record(l.startsWith("‼️") ? "alert" : l.startsWith("✅") ? "ok" : "warn", l);
    }
    await this.save();
  }

  /**
   * Vor dem Beenden des Hubs, nachdem die Zustellung abgeschlossen ist: den
   * Ausgang der laufenden Meldungen abwarten und den Stand speichern. Eine
   * Meldung, die keinen Chat mehr erreicht hat, kommt so nach dem Neustart
   * erneut.
   */
  async close(): Promise<void> {
    await Promise.all([...this.sending]);
    await this.save();
  }
}
