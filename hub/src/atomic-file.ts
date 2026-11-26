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

export interface AtomicWriteOptions {
  /**
   * Rechte der Datei (z. B. 0o600 fuer Zugangsdaten). Die zweite Datei wird
   * gleich mit diesen Rechten angelegt, nie erst mit weiteren und dann
   * eingeschraenkt; das Umbenennen uebernimmt sie fuer das Ziel. Ohne Angabe
   * gelten die Rechte des Prozesses wie bisher.
   */
  mode?: number;
}

export async function writeFileAtomic(file: string, data: string, opts: AtomicWriteOptions = {}): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const { mode } = opts;
  try {
    // Mit Rechten: Ein liegengebliebener Rest koennte weitere haben. Neu
    // anlegen ("wx") statt ihn zu oeffnen, sonst blieben seine Rechte.
    if (mode !== undefined) await rm(tmp, { force: true });
    const handle = mode === undefined ? await open(tmp, "w") : await open(tmp, "wx", mode);
    try {
      // Die Maske des Prozesses kann beim Anlegen Rechte wegnehmen, aber nie
      // welche hinzufuegen: danach genau die verlangten setzen.
      if (mode !== undefined) await handle.chmod(mode);
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
