/**
 * MAC-Adressen vergleichbar machen.
 *
 * Gespeichert wird einheitlich "AA:BB:CC:DD:EE:FF". Fuer Abfragen gegen
 * Altbestaende mit anderer Schreibweise gibt `macSpellings` alle ueblichen
 * Varianten fuer ein `in`-Filter zurueck. Ein `in` mit `mode: "insensitive"`
 * findet unter Prisma 7 (getestet mit 7.4.1 gegen Postgres 16) naemlich gar
 * nichts, auch nicht bei exakt gleicher Schreibweise. Genau daran ist der
 * MAC-Abgleich des Hub-Scans seit September stillschweigend gescheitert.
 */

/** "aa-bb-cc-dd-ee-ff", "AABBCCDDEEFF", " aa:bb:… " -> "AA:BB:CC:DD:EE:FF"; sonst null. */
export function normalizeMac(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^[0-9a-fA-F]{2}([:-]?[0-9a-fA-F]{2}){5}$/.test(trimmed)) return null;
  const hex = trimmed.replace(/[:-]/g, "").toUpperCase();
  return hex.match(/../g)!.join(":");
}

/** Alle gaengigen Schreibweisen der MACs (gross/klein, Doppelpunkt/Bindestrich). */
export function macSpellings(macs: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const raw of macs) {
    const mac = normalizeMac(raw);
    if (!mac) continue;
    const lower = mac.toLowerCase();
    out.add(mac);
    out.add(lower);
    out.add(mac.replace(/:/g, "-"));
    out.add(lower.replace(/:/g, "-"));
  }
  return [...out];
}
