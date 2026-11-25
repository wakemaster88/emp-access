/**
 * Merkliste der Personen auf der Platte (.cache/agent-people.json): lesen und
 * in einem Zug schreiben. Ohne Hub-Konfiguration, der Pfad kommt vom Aufrufer.
 */
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../atomic-file.js";
import { reviveStore, type PeopleStore } from "./people-rules.js";

export interface PeopleRead {
  store: PeopleStore;
  /** Was beim Lesen nicht stimmte (fuer das Log); null = gelesen oder noch keine Datei. */
  problem: string | null;
}

/**
 * Datei lesen. Scheitert das Lesen, beginnt die Liste leer und `problem`
 * nennt den Grund. Eine fehlende Datei ist kein Fehler: Dann wurde noch nie
 * etwas gemerkt.
 */
export async function readPeopleFile(file: string, now = Date.now()): Promise<PeopleRead> {
  const empty = (problem: string | null): PeopleRead => ({ store: { cleared: [], pending: [] }, problem });
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code === "ENOENT") return empty(null);
    return empty(`Datei nicht lesbar (${e instanceof Error ? e.message : e}), beginne mit leerer Liste`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return empty("Inhalt nicht lesbar (kein gültiges JSON), beginne mit leerer Liste");
  }
  const revived = reviveStore(raw, now);
  if (!revived) return empty("Inhalt nicht lesbar (kein Objekt), beginne mit leerer Liste");
  return {
    store: revived.store,
    problem: revived.dropped ? `${revived.dropped} ${revived.dropped === 1 ? "Eintrag" : "Einträge"} nicht lesbar, übersprungen` : null,
  };
}

export function writePeopleFile(file: string, store: PeopleStore): Promise<void> {
  return writeFileAtomic(file, JSON.stringify(store, null, 2));
}
