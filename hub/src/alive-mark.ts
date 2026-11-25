/**
 * Lebenszeichen des Hub-Prozesses auf der Platte: alle 30 s ein Zeitstempel.
 * Nach einem Neustart weiss der Hub damit, bis wann sein Vorgaenger lief,
 * auch nach einem Stromausfall, bei dem nichts mehr aufraeumen konnte. Die
 * Cloud beendet damit die Ereignisse, die beim Ausfall liefen, zum Zeitpunkt
 * des Ausfalls und nicht erst zum Wiederanlauf.
 */
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "./config.js";
import { ALIVE_INTERVAL_MS, parseAliveMark } from "./alive-mark-rules.js";

export { ALIVE_INTERVAL_MS };

const ALIVE_FILE = path.join(CONFIG.hubDir, ".cache", "alive.json");

/** undefined = noch nicht gelesen. */
let previous: string | null | undefined;
let lastWriteAt = 0;

/** Bis wann der vorige Hub-Prozess lief (null = unbekannt). Liest einmal, vor dem ersten Schreiben. */
export function previousAliveAt(): string | null {
  if (previous === undefined) {
    try {
      previous = parseAliveMark(readFileSync(ALIVE_FILE, "utf8"), Date.now());
    } catch {
      previous = null;
    }
  }
  return previous;
}

/**
 * Lebenszeichen schreiben, hoechstens alle 30 s. Erst in eine zweite Datei,
 * dann umbenennen: Faellt der Strom mitten im Schreiben aus, bleibt der alte
 * Stand lesbar. Ein Fehler ist folgenlos, der naechste Takt schreibt neu.
 */
export function markAlive(now = Date.now()): void {
  if (now - lastWriteAt < ALIVE_INTERVAL_MS) return;
  previousAliveAt(); // erst den Stand des Vorgaengers sichern
  lastWriteAt = now;
  const tmp = `${ALIVE_FILE}.tmp`;
  void (async () => {
    await mkdir(path.dirname(ALIVE_FILE), { recursive: true });
    await writeFile(tmp, JSON.stringify({ at: new Date(now).toISOString() }), "utf8");
    await rename(tmp, ALIVE_FILE);
  })().catch(() => {});
}
