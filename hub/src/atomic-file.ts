/**
 * Datei in einem Zug ersetzen: erst in eine zweite Datei daneben schreiben,
 * dann umbenennen. Endet der Hub mitten im Schreiben (Update, Stromausfall),
 * bleibt der letzte vollstaendige Stand lesbar. Ohne Abhaengigkeiten, damit
 * jedes Modul die Funktion nutzen kann.
 *
 * Zwei gleichzeitige Aufrufe fuer dieselbe Datei teilen sich die zweite
 * Datei: Wer mehrere Stellen hat, die schreiben, reiht die Aufrufe selbst
 * hintereinander (siehe agent/people.ts).
 */
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

export async function writeFileAtomic(file: string, data: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  try {
    const handle = await open(tmp, "w");
    try {
      await handle.writeFile(data, "utf8");
      // Erst auf die Platte, dann umbenennen: Sonst kann nach einem
      // Stromausfall der neue Name auf eine leere Datei zeigen.
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, file);
  } catch (e) {
    // Die halbe zweite Datei nicht liegen lassen; der alte Stand bleibt.
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}
