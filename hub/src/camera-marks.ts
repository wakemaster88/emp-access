/**
 * Merkliste je Kamera auf der Platte (hub/.cache): Kamera-ID und Zeitpunkt,
 * sonst nichts – keine Adressen, keine Zugangsdaten. Der Hub merkt sich
 * damit ueber einen Neustart hinweg, was nur er weiss und was im Speicher
 * verloren ginge.
 */
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCameraMarks, serializeCameraMarks, unknownMarks } from "./camera-marks-rules.js";

export class CameraMarks {
  /** null = noch nicht gelesen. */
  private marks: Map<number, number> | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  /** Liest einmal, vor dem ersten Schreiben; danach gilt der Stand im Speicher. */
  private load(): Map<number, number> {
    if (this.marks === null) {
      try {
        this.marks = parseCameraMarks(readFileSync(this.file, "utf8"), Date.now());
      } catch {
        this.marks = new Map();
      }
    }
    return this.marks;
  }

  /** Gemerkter Zeitpunkt (ms) einer Kamera, null = keiner. */
  get(cameraId: number): number | null {
    return this.load().get(cameraId) ?? null;
  }

  /** Alle Eintraege als [Kamera-ID, Zeitpunkt]. */
  entries(): Array<[number, number]> {
    return [...this.load()];
  }

  /**
   * Zeitpunkt merken. Das Promise ist erfuellt, sobald der Stand auf der
   * Platte steht; wer darauf nicht warten muss, laesst es liegen.
   */
  set(cameraId: number, at: number): Promise<void> {
    this.load().set(cameraId, at);
    return this.save();
  }

  /**
   * Eintrag loeschen. Mit `at` nur, wenn noch genau dieser Zeitpunkt gemerkt
   * ist: Ein neuerer Eintrag derselben Kamera bleibt stehen.
   */
  delete(cameraId: number, at?: number): Promise<void> {
    const marks = this.load();
    if (!marks.has(cameraId) || (at !== undefined && marks.get(cameraId) !== at)) return this.saving;
    marks.delete(cameraId);
    return this.save();
  }

  /** Nur die Eintraege dieser Kameras behalten; schreibt nur, wenn dabei einer entfaellt. */
  keepOnly(cameraIds: ReadonlySet<number>): Promise<void> {
    const marks = this.load();
    const gone = unknownMarks(marks, cameraIds);
    if (gone.length === 0) return this.saving;
    for (const cameraId of gone) marks.delete(cameraId);
    return this.save();
  }

  /**
   * Stand schreiben, einer nach dem anderen (zwei Schreiber teilten sich
   * sonst die Zwischendatei). Erst in eine zweite Datei, dann umbenennen:
   * Faellt der Strom mitten im Schreiben aus, bleibt der alte Stand lesbar.
   * Ein Fehler ist folgenlos, die naechste Aenderung schreibt neu.
   */
  private save(): Promise<void> {
    this.saving = this.saving.then(async () => {
      const tmp = `${this.file}.tmp`;
      try {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(tmp, serializeCameraMarks(this.load()), "utf8");
        await rename(tmp, this.file);
      } catch {
        // folgenlos, siehe oben
      }
    });
    return this.saving;
  }
}
