/**
 * Einstellung „Wächter“ je Kamera (Cloud, Spalte Camera.sentinelMode). Reine
 * Logik, ohne Netz und ohne Uhr.
 *
 *  - wie der Raum (Standard, in der Cloud null): bewertet, solange der Raum
 *    der Kamera geschlossen ist; ohne Betriebszeit im Nachtfenster.
 *  - nur nachts ("NIGHT"): allein das Nachtfenster entscheidet, ob der Raum
 *    offen oder geschlossen ist, spielt keine Rolle. Das gilt auch mit
 *    HUB_AGENT_SENTINEL=always (modeAlways).
 *  - aus ("OFF"): der Waechter bewertet die Kamera nicht.
 *
 * Ein fehlendes Feld (aeltere Cloud) und jeder unbekannte Wert gelten als
 * Standard. Die Gesichts- und Kennzeichenerkennung haengen nicht an dieser
 * Einstellung. Die Ueberwachung der Cloud meldet unbekannte Personen an einer
 * Kamera nur dann nicht selbst, wenn der Waechter sie gerade bewacht
 * (sentinel-cover-rules.ts); eine Kamera auf „aus“ bewacht er nie.
 */

export type SentinelMode = "raum" | "nachts" | "aus";

/** Wert aus der Kamera-Liste der Cloud lesen; alles Unbekannte ist der Standard. */
export function readSentinelMode(value: unknown): SentinelMode {
  const v = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (v === "NIGHT") return "nachts";
  if (v === "OFF") return "aus";
  return "raum";
}

/**
 * Was der Takt des Waechters fuer ein Ereignis der Kamera als „Raum
 * geschlossen“ bekommt (SentinelContext.closed), oder „aus“: dann wird das
 * Ereignis nicht bewertet. Bei „nur nachts“ ist das null: Dann entscheidet
 * das Nachtfenster. Ist die Stunde nicht lesbar, laesst sich die Nacht nicht
 * ausschliessen: Die Kamera gilt dann als bewacht (true).
 */
export function sentinelClosed(mode: SentinelMode, roomClosed: boolean | null, hour: number): boolean | null | "aus" {
  if (mode === "aus") return "aus";
  if (mode === "nachts") return Number.isFinite(hour) ? null : true;
  return roomClosed;
}

/**
 * Gilt HUB_AGENT_SENTINEL=always fuer diese Kamera? Nur bei „wie der Raum“:
 * Eine Kamera auf „nur nachts“ bewacht der Waechter allein im Nachtfenster,
 * eine auf „aus“ nie. Dieselbe Regel gilt fuer die Ausloeser, die Liste fuer
 * die Cloud und den Bewachungs-Zustand im Log.
 */
export function modeAlways(mode: SentinelMode, always: boolean): boolean {
  return always && mode === "raum";
}

/** Kurztext der Einstellung. */
const SHORT: Record<SentinelMode, string> = { raum: "wie der Raum", nachts: "nur nachts", aus: "aus" };

/** Text fuer das Log, mit dem, was die Einstellung bewirkt. */
export function sentinelModeText(mode: SentinelMode, nightWindow: string): string {
  if (mode === "aus") return "Wächter aus, die Kamera wird nicht bewertet";
  if (mode === "nachts") return `Wächter nur nachts (${nightWindow} Uhr)`;
  return "Wächter wie der Raum";
}

export interface CameraMode {
  id: number;
  name: string;
  mode: SentinelMode;
}

/**
 * Log-Zeilen zur Einstellung „Wächter“: beim Start (`prev` = null) eine Zeile
 * je Kamera, die vom Standard abweicht, danach eine je Aenderung. Eine neue
 * Kamera zaehlt wie beim Start, eine entfernte schreibt nichts. `next` ist
 * der Stand fuer den naechsten Aufruf.
 */
export function sentinelModeLines(
  prev: ReadonlyMap<number, SentinelMode> | null,
  cams: readonly CameraMode[],
  nightWindow: string
): { lines: string[]; next: Map<number, SentinelMode> } {
  const lines: string[] = [];
  const next = new Map<number, SentinelMode>();
  for (const c of cams) {
    next.set(c.id, c.mode);
    const before = prev?.get(c.id);
    if (before === undefined) {
      if (c.mode !== "raum") lines.push(`Wächter: Kamera ${c.name}: ${sentinelModeText(c.mode, nightWindow)}`);
    } else if (before !== c.mode) {
      lines.push(`Wächter: Kamera ${c.name}: jetzt ${sentinelModeText(c.mode, nightWindow)} (vorher ${SHORT[before]})`);
    }
  }
  return { lines, next };
}
