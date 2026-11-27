/**
 * Einstellung „Livebild und Vorschau“ je Kamera (Spalte Camera.liveMode).
 *
 * - null oder "AUTO": automatisch (wie bisher). Das Livebild startet in der
 *   Zentrale von selbst, das Vorschaubild kommt in die Cloud.
 * - "CLICK": nur auf Tippen. Kein Vorschaubild in der Cloud, das Livebild
 *   startet in der Zentrale erst auf Tippen.
 * - "OFF": aus. Keine Kachel, kein Livebild, kein Vorschaubild.
 *
 * Gespeichert wird "CLICK" oder "OFF"; „automatisch“ steht als null in der
 * Spalte. Ein unbekannter Wert gilt wie "CLICK" (die sichere Seite), genau
 * wie im Hub (hub/src/live-mode-rules.ts).
 */

export const LIVE_MODES = ["AUTO", "CLICK", "OFF"] as const;
export type LiveMode = (typeof LIVE_MODES)[number];

/** Fehlertext der API bei einem ungültigen Wert. */
export const LIVE_MODE_ERROR = "Livebild und Vorschau: automatisch, nur auf Tippen oder aus wählen";

/**
 * Wert aus Formular oder API prüfen: leer und "AUTO" werden null
 * (automatisch), "CLICK" und "OFF" bleiben, alles andere ist ungültig.
 */
export function parseLiveMode(value: unknown): "CLICK" | "OFF" | null | "invalid" {
  if (value === null || value === "" || value === "AUTO") return null;
  if (value === "CLICK" || value === "OFF") return value;
  return "invalid";
}

/** Gespeicherten Wert lesen; unbekannte Werte gelten als "CLICK". */
export function readLiveMode(raw: string | null | undefined): LiveMode {
  if (raw == null) return "AUTO";
  const v = raw.trim().toUpperCase();
  if (v === "" || v === "AUTO") return "AUTO";
  if (v === "OFF") return "OFF";
  return "CLICK";
}

/**
 * Darf die Cloud ein Vorschaubild dieser Kamera speichern, zeigen oder beim
 * Hub anfordern? Nur bei „automatisch“.
 */
export function previewAllowed(raw: string | null | undefined): boolean {
  return readLiveMode(raw) === "AUTO";
}

/** Bekommt die Kamera eine Bildfläche? Nicht bei „aus“ (im Kontrollzentrum bleibt dann nur die Steuerung). */
export function liveTileShown(raw: string | null | undefined): boolean {
  return readLiveMode(raw) !== "OFF";
}

/**
 * Felder für das Update einer Kamera: Ist die neue Einstellung „nur auf
 * Tippen“ oder „aus“, fällt das gespeicherte Vorschaubild im selben Update weg.
 */
export function liveModeUpdateData(liveMode: "CLICK" | "OFF" | null): {
  liveMode: "CLICK" | "OFF" | null;
  snapshot?: null;
  snapshotAt?: null;
} {
  return previewAllowed(liveMode) ? { liveMode } : { liveMode, snapshot: null, snapshotAt: null };
}

/**
 * Daten für die Kamera-Zeile, wenn ein Bild der Kamera eintrifft (Hub):
 * „zuletzt gesehen“ immer (sofern `seen`), das Vorschaubild nur bei
 * „automatisch“.
 */
export function previewWriteData<T>(
  raw: string | null | undefined,
  snapshot: T,
  at: Date,
  seen: boolean,
): { snapshot?: T; snapshotAt?: Date; lastSeenAt?: Date } {
  const seenData = seen ? { lastSeenAt: at } : {};
  return previewAllowed(raw) ? { snapshot, snapshotAt: at, ...seenData } : seenData;
}

/** Zeitpunkt des Vorschaubilds für die Oberfläche: null, wenn keins gezeigt werden darf. */
export function shownSnapshotAt<T>(raw: string | null | undefined, snapshotAt: T | null): T | null {
  return previewAllowed(raw) ? snapshotAt : null;
}

/** Kurzer, neutraler Text anstelle des Bildes bei „nur auf Tippen“. */
export const LIVE_MODE_CLICK_TEXT = "Livebild nur in der Zentrale auf Tippen";

/** Fehlertext, wenn jemand für eine solche Kamera ein Bild anfordert. */
export const PREVIEW_BLOCKED_ERROR = "Für diese Kamera gibt es kein Vorschaubild (Livebild und Vorschau: nur auf Tippen oder aus)";

/** Hinweis unter der Auswahl im Kamera-Formular. */
export function liveModeHint(value: string): string {
  const mode = readLiveMode(value || null);
  if (mode === "CLICK") return "Kein Vorschaubild, das Livebild startet in der Zentrale erst auf Tippen.";
  if (mode === "OFF") return "Keine Kachel, kein Livebild, kein Vorschaubild.";
  return "Das Livebild startet in der Zentrale von selbst, das Vorschaubild kommt bei Bewegung in die Cloud.";
}
