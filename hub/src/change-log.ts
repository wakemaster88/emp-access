/**
 * Routinezeile nur schreiben, wenn sich ihr Inhalt aendert (oder nach
 * `repeatMs` zur Erinnerung). Liefert true, wenn geschrieben werden soll.
 */
export class ChangeLog {
  private last = new Map<string, { text: string; at: number }>();

  constructor(private readonly repeatMs = 0) {}

  shouldLog(key: string, text: string, now: number): boolean {
    const prev = this.last.get(key);
    if (prev && prev.text === text && (this.repeatMs <= 0 || now - prev.at < this.repeatMs)) return false;
    this.last.set(key, { text, at: now });
    return true;
  }
}
