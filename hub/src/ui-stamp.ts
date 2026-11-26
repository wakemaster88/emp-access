/**
 * Stand der Dashboard-Oberflaeche (reine Logik, testbar: ui-stamp.test.ts).
 *
 * Der Hub zieht Updates ohne Neustart. Damit eine lange offene Zentrale
 * merkt, dass ihr Code alt ist, traegt die ausgelieferte Seite den Stand,
 * mit dem sie ausgeliefert wurde (`<meta name="hub-ui" content="…">`), und
 * /api/status nennt den aktuellen (`ui`). Der Stand entsteht aus den rohen
 * ETags der Dateien; das Einsetzen in die Seite aendert ihn nicht.
 */
import { createHash } from "node:crypto";

/** Schwaches ETag aus Groesse und Aenderungszeit einer Datei. */
export function assetEtag(info: { size: number; mtimeMs: number }): string {
  return `W/"${info.size}-${Math.floor(info.mtimeMs)}"`;
}

/** Stand der Oberflaeche aus den ETags ihrer Dateien (12 Hex-Zeichen). */
export function uiStampFromEtags(tags: string[]): string {
  return createHash("sha256").update(tags.join("|")).digest("hex").slice(0, 12);
}

/** Platzhalter in dashboard.html; der Hub setzt beim Ausliefern den Stand ein. */
export const UI_META_PLACEHOLDER = '<meta name="hub-ui" content="">';

/** Seite mit eingesetztem Stand; ohne Platzhalter oder mit ungueltigem Stand unveraendert. */
export function withUiStamp(html: string, stamp: string): string {
  if (!/^[0-9a-f]{1,64}$/.test(stamp)) return html;
  return html.replace(UI_META_PLACEHOLDER, `<meta name="hub-ui" content="${stamp}">`);
}

/** ETag der ausgelieferten Seite: folgt dem Stand, nicht nur der HTML-Datei. */
export function uiHtmlEtag(stamp: string): string {
  return `W/"ui-${stamp}"`;
}
