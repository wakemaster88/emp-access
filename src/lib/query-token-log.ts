// Beobachtung: Welche Routen werden noch mit `?token=` statt Header
// aufgerufen? Eine Zeile je Route und Instanz und Stunde, ohne das Token.
const QUERY_TOKEN_LOG_INTERVAL_MS = 60 * 60_000;
const QUERY_TOKEN_LOG_MAX_ROUTES = 500;
const queryTokenLoggedAt = new Map<string, number>();

/** true, wenn fuer diese Route in dieser Instanz gerade eine Zeile faellig ist. */
export function shouldLogQueryToken(path: string, now = Date.now()): boolean {
  const last = queryTokenLoggedAt.get(path);
  if (last != null && now - last < QUERY_TOKEN_LOG_INTERVAL_MS) return false;
  if (last == null && queryTokenLoggedAt.size >= QUERY_TOKEN_LOG_MAX_ROUTES) {
    const firstKey = queryTokenLoggedAt.keys().next().value;
    if (firstKey) queryTokenLoggedAt.delete(firstKey);
  }
  queryTokenLoggedAt.set(path, now);
  return true;
}

/** Test-Helper: Merker fuer die Query-Token-Zeilen leeren. */
export function _clearQueryTokenLog() {
  queryTokenLoggedAt.clear();
}

/** Die Log-Zeile: fester Präfix, Pfad und Art – nie das Token. */
export function queryTokenLogLine(path: string, kind: "account" | "device"): string {
  return `[api-token-query] ${JSON.stringify({ path, kind })}`;
}
