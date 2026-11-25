/**
 * Zwischenspeicher fuer die Sitzungspruefung im jwt-Callback (auth.ts).
 *
 * Ein Token wird spaetestens alle `ttlMs` gegen die Datenbank geprueft. Ohne
 * Zwischenspeicher fragt jede Anfrage mit einem aelteren Token erneut nach,
 * bis der Browser das erneuerte Cookie abholt – bei dauerhaft offenen Tabs
 * mit Polling bei jedem Aufruf. Hier haelt jede Instanz das Ergebnis je
 * Admin-ID `ttlMs` lang im Prozessspeicher: hoechstens eine Abfrage je Admin
 * und Zeitfenster.
 *
 * Das Ergebnis traegt den Zeitpunkt der echten Abfrage (`checkedAt`). Der
 * Aufrufer schreibt diesen Zeitpunkt ins Token, nicht „jetzt“ – so bleibt
 * eine Aenderung in der Datenbank (Passwortwechsel, geloeschter Admin,
 * deaktivierter Account) nach hoechstens `ttlMs` wirksam.
 */

export type AdminSessionState = {
  role: string;
  accountId: number | null;
  accountName: string | null;
  sessionVersion: number;
  /** false, wenn der Account des Admins deaktiviert ist. */
  accountActive: boolean;
} | null;

export type SessionCheck = { checkedAt: number; state: AdminSessionState };

const MAX_ENTRIES = 1_000;

export function createSessionRevalidator(
  load: (adminId: number) => Promise<AdminSessionState>,
  ttlMs: number,
) {
  // Laufende Abfrage als Promise: gleichzeitige Anfragen teilen sich eine.
  const cache = new Map<number, { checkedAt: number; result: Promise<SessionCheck> }>();

  return async function check(adminId: number, now = Date.now()): Promise<SessionCheck> {
    const cached = cache.get(adminId);
    if (cached && now - cached.checkedAt < ttlMs) return cached.result;

    if (cache.size >= MAX_ENTRIES) cache.clear();
    const result = load(adminId).then((state) => ({ checkedAt: now, state }));
    cache.set(adminId, { checkedAt: now, result });
    try {
      return await result;
    } catch (err) {
      // Fehler nicht zwischenspeichern: die naechste Anfrage fragt neu.
      if (cache.get(adminId)?.result === result) cache.delete(adminId);
      throw err;
    }
  };
}

/**
 * Wie `check(adminId)`, aber ein Fehler beim Laden (etwa ein kurzer Aussetzer
 * der Datenbank) ergibt `undefined` statt einer Ausnahme. Der jwt-Callback
 * laesst das Token dann unveraendert, statt die Sitzung zu beenden; die
 * naechste Anfrage prueft neu.
 */
export async function revalidateOrKeep(
  check: (adminId: number) => Promise<SessionCheck>,
  adminId: number,
): Promise<SessionCheck | undefined> {
  try {
    return await check(adminId);
  } catch (err) {
    console.warn("[auth] Sitzungspruefung fehlgeschlagen, Token bleibt unveraendert:", err instanceof Error ? err.message : err);
    return undefined;
  }
}
