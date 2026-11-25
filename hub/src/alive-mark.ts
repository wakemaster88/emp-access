/**
 * Lebenszeichen des Hub-Prozesses auf der Platte: alle 30 s ein Zeitstempel.
 * Nach einem Neustart weiss der Hub damit, bis wann sein Vorgaenger lief,
 * auch nach einem Stromausfall, bei dem nichts mehr aufraeumen konnte. Die
 * Cloud beendet damit die Ereignisse, die beim Ausfall liefen, zum Zeitpunkt
 * des Ausfalls und nicht erst zum Wiederanlauf.
 */
import { readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG, log } from "./config.js";
import { ALIVE_INTERVAL_MS, AliveWriteState, parseAliveMark } from "./alive-mark-rules.js";

export { ALIVE_INTERVAL_MS };

const ALIVE_FILE = path.join(CONFIG.hubDir, ".cache", "alive.json");

/** undefined = noch nicht gelesen. */
let previous: string | null | undefined;
let lastWriteAt = 0;
/** Ein Schreibversuch laeuft noch. */
let writing = false;
const writes = new AliveWriteState();

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
 * Stand lesbar. Scheitert das Schreiben, wird der alte Stand entfernt, und
 * der naechste Takt schreibt neu: Ein Stand, der nicht mehr erneuert wird,
 * gaelte nach dem naechsten Start als Ende dieses Prozesses. Ohne Datei
 * meldet der Start kein Lebenszeichen, und die Cloud richtet sich nach der
 * letzten Meldung der Kamera.
 */
export function markAlive(now = Date.now()): void {
  // Nie zwei Versuche zugleich: Sie teilten sich die Zwischendatei, und der
  // Fehler des einen naehme den frischen Stand des anderen von der Platte.
  if (writing || now - lastWriteAt < ALIVE_INTERVAL_MS) return;
  previousAliveAt(); // erst den Stand des Vorgaengers sichern
  lastWriteAt = now;
  writing = true;
  const tmp = `${ALIVE_FILE}.tmp`;
  void (async () => {
    let error: string | null = null;
    try {
      await mkdir(path.dirname(ALIVE_FILE), { recursive: true });
      await writeFile(tmp, JSON.stringify({ at: new Date(now).toISOString() }), "utf8");
      await rename(tmp, ALIVE_FILE);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const step = writes.after(error, Date.now());
    // Fehlt die Datei schon, ist nichts zu entfernen.
    if (step.removeOld) await unlink(ALIVE_FILE).catch(() => {});
    if (step.log) log(step.log);
  })()
    .catch(() => {})
    .finally(() => {
      writing = false;
    });
}
