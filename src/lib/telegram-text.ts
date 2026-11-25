/**
 * Texte fuer Telegram-Nachrichten im HTML-Modus. Rein und ohne
 * Abhaengigkeiten, damit es Server und Tests gleich nutzen.
 */

/** Hoechstlaenge einer Telegram-Textnachricht. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Maskiert &, < und > in eingesetzten Texten (Namen, Bezeichnungen), damit
 * Telegram sie als Text zeigt. Bewusst gesetzte Tags wie <b> gehoeren nicht
 * hier hinein, sondern um den maskierten Wert herum.
 */
export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Kuerzt eine mehrzeilige Nachricht auf `limit` Zeichen. Geschnitten wird am
 * Ende einer Zeile, damit kein Tag und keine Maskierung halbiert wird; am
 * Schluss steht "…" als Hinweis, dass etwas fehlt. Voraussetzung: jede Zeile
 * schliesst ihre Tags selbst.
 */
export function truncateTelegramLines(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string {
  if (text.length <= limit) return text;
  const marker = "\n…";
  const budget = limit - marker.length;
  const cut = text.lastIndexOf("\n", budget);
  const head = cut > 0 ? text.slice(0, cut) : text.slice(0, budget);
  return head.replace(/\s+$/, "") + marker;
}

/** So viele Einträge zeigt eine Liste im Tagesbericht höchstens. */
export const TELEGRAM_LIST_LIMIT = 30;

/**
 * Begrenzt die Zeilen einer Liste auf `limit` Einträge; der Rest steht als
 * "… und N weitere" in einer eigenen Zeile mit derselben Einrückung.
 */
export function capTelegramList(
  lines: string[],
  limit = TELEGRAM_LIST_LIMIT,
  indent = "  ",
): string[] {
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `${indent}• … und ${lines.length - limit} weitere`];
}
