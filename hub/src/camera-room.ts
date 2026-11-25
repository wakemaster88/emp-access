/**
 * Betriebszustand je Kamera fuer das Folgen der Schwenk-Kameras
 * (camera-motion.ts): Ist der Raum der Kamera gerade geschlossen? Den Stand
 * ermittelt der Waechter aus den Raumdaten (agent/sentinel.ts, cameraClosed);
 * startSentinel traegt die Abfrage hier ein.
 *
 * Ein eigenes Modul, weil agent/sentinel.ts cameras.ts importiert: cameras.ts
 * kann sentinel.ts nicht ohne Import-Zyklus einbinden (wie sentinel-vouch.ts).
 * Ohne Eintrag (Assistent aus) oder wenn die Abfrage scheitert: null =
 * unbekannt, dann entscheidet das Nachtfenster des Waechters.
 */

let check: ((cameraId: number) => boolean | null) | null = null;

/** Abfrage des Waechters eintragen (startSentinel); null nimmt sie wieder heraus. */
export function setCameraRoomClosed(fn: ((cameraId: number) => boolean | null) | null): void {
  check = fn;
}

/** Raum der Kamera geschlossen? true = geschlossen, false = offen, null = unbekannt. */
export function cameraRoomClosed(cameraId: number): boolean | null {
  if (!check) return null;
  try {
    const v = check(cameraId);
    return v === true ? true : v === false ? false : null;
  } catch {
    return null;
  }
}

/**
 * Nachtfenster des Waechters (HUB_AGENT_SENTINEL_NIGHT, Vorgabe 22-6). Erst
 * beim Aufruf gelesen: Beim Laden dieses Moduls kann hub/.env noch fehlen.
 */
export function sentinelNightWindow(env: NodeJS.ProcessEnv = process.env): string {
  return (env.HUB_AGENT_SENTINEL_NIGHT || "22-6").trim();
}
