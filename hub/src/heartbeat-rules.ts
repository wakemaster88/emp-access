/**
 * Lebenszeichen an die Cloud nacheinander: Ein Lebenszeichen, das waehrend
 * eines laufenden angefordert wird, beginnt erst nach dessen Antwort und
 * baut seinen Inhalt erst dann. So kommt in der Cloud immer der neueste Stand
 * zuletzt an; ein frueher gebautes Lebenszeichen kann einen spaeteren (etwa
 * die Liste bewachter Kameras nach dem Wegfall einer Kamera) nicht
 * ueberschreiben. Mehrere Anforderungen waehrend eines Laufs ergeben einen
 * weiteren Lauf. Reine Logik ohne Netz.
 */

/**
 * `send` nacheinander ausfuehren. Der Aufruf liefert das Versprechen des
 * Laufs, der die Anforderung erfuellt. `send` darf nicht werfen; tut es das
 * doch, laeuft der naechste Lauf trotzdem.
 */
export function serialRuns(send: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  const start = (): Promise<void> => {
    const run = Promise.resolve()
      .then(send)
      .catch(() => undefined)
      .finally(() => {
        if (running === run) running = null;
      });
    running = run;
    return run;
  };
  return () => {
    if (queued) return queued;
    if (!running) return start();
    queued = running.then(() => {
      queued = null;
      return start();
    });
    return queued;
  };
}
