/**
 * Kleiner Zwischenspeicher im Modul-Speicher einer Function.
 *
 * Haelt das Ergebnis einer teuren Abfrage je Schluessel fuer `ttlMs`.
 * Gleichzeitige Aufrufe mit demselben Schluessel teilen sich einen laufenden
 * Abruf. Ein fehlgeschlagener Abruf wird nicht gespeichert, der naechste
 * Aufruf versucht es erneut. Auf Vercel wirkt der Speicher je Instanz; das
 * reicht, um wiederholte Polls derselben Anzeige zu entlasten.
 */
export interface TtlCache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
  readonly size: number;
}

export function createTtlCache<T>(
  ttlMs: number,
  opts: { maxEntries?: number; now?: () => number } = {},
): TtlCache<T> {
  const maxEntries = opts.maxEntries ?? 500;
  const now = opts.now ?? Date.now;
  const entries = new Map<string, { expiresAt: number; promise: Promise<T> }>();

  function prune(t: number) {
    for (const [k, e] of entries) {
      if (e.expiresAt <= t) entries.delete(k);
    }
    // Map haelt die Einfuegereihenfolge: die aeltesten Eintraege zuerst raus.
    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    get(key, load) {
      const t = now();
      const hit = entries.get(key);
      if (hit && hit.expiresAt > t) return hit.promise;
      if (hit) entries.delete(key);
      prune(t);
      const promise = load();
      const entry = { expiresAt: t + ttlMs, promise };
      entries.set(key, entry);
      promise.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
      return promise;
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
