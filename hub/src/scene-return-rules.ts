/**
 * Rueckkehr einer Kamera-Szene ueber einen Neustart des Hubs: Eine Regel
 * „Kamera steuern … zurueck nach N s“ stellt die Kamera nach Ablauf zurueck
 * (cameras.ts, `cameraScene`). Der Zeitpunkt steht in
 * hub/.cache/scene-returns.json; beim Start entscheidet `dueSceneReturns`,
 * was sofort zurueckgestellt, was neu angesetzt und was verworfen wird.
 * Ist die Kamera-Liste dabei nicht zu laden (Cloud nicht erreichbar), bleibt
 * der Eintrag stehen, und der Hub versucht es spaeter erneut
 * (`sceneReturnCamera`). Reine Logik.
 */

/** Eintraege, die laenger gespeichert sind, verwirft der Start (mit Log-Zeile). */
export const SCENE_RETURN_KEEP_MS = 24 * 3_600_000;

/** Kamera-Liste beim Start nicht ladbar: so lange bis zum naechsten Versuch. */
export const SCENE_RETURN_RETRY_MS = 60_000;

export interface SavedSceneReturn {
  cameraId: number;
  /** Faellig um (ms). */
  dueAt: number;
  /** Preset der Szene; die Rueckkehr faehrt es erneut an. */
  presetId: number | null;
  /** Tracking danach wieder einschalten (Zustand vor der Szene). */
  restoreTrack: boolean | null;
  /** Gespeichert um (ms). */
  savedAt: number;
}

/** Gespeicherte Rueckkehr lesen; Unbrauchbares faellt weg, je Kamera der juengste Eintrag. */
export function parseSceneReturns(raw: unknown): SavedSceneReturn[] {
  if (!Array.isArray(raw)) return [];
  const byCamera = new Map<number, SavedSceneReturn>();
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object") continue;
    const { cameraId, dueAt, presetId, restoreTrack, savedAt } = r;
    if (typeof cameraId !== "number" || !Number.isInteger(cameraId)) continue;
    if (typeof dueAt !== "number" || !Number.isFinite(dueAt) || typeof savedAt !== "number" || !Number.isFinite(savedAt)) continue;
    if (presetId !== null && (typeof presetId !== "number" || !Number.isInteger(presetId))) continue;
    if (restoreTrack !== null && typeof restoreTrack !== "boolean") continue;
    const entry = { cameraId, dueAt, presetId, restoreTrack, savedAt };
    const prev = byCamera.get(cameraId);
    if (!prev || prev.savedAt <= savedAt) byCamera.set(cameraId, entry);
  }
  return [...byCamera.values()];
}

export interface SceneReturnPlan {
  /** Jetzt zurueckstellen (die Frist lief waehrend des Neustarts ab). */
  due: SavedSceneReturn[];
  /** Noch nicht faellig: neu ansetzen. */
  later: SavedSceneReturn[];
  /** Aelter als 24 h gespeichert: verwerfen, die Kamera bleibt, wie sie ist. */
  discarded: SavedSceneReturn[];
}

/** Was nach dem Start mit jeder gespeicherten Rueckkehr geschieht. */
export function dueSceneReturns(saved: SavedSceneReturn[], now: number): SceneReturnPlan {
  const out: SceneReturnPlan = { due: [], later: [], discarded: [] };
  for (const r of saved) {
    if (now - r.savedAt > SCENE_RETURN_KEEP_MS) out.discarded.push(r);
    else if (r.dueAt <= now) out.due.push(r);
    else out.later.push(r);
  }
  return out;
}

/**
 * Rueckkehr einer gespeicherten Szene nach dem Start, je nach Kamera:
 *  - bekannt: zurueckstellen oder neu ansetzen (`restore`);
 *  - Kamera-Liste nicht ladbar: behalten, auch auf der Platte, und spaeter
 *    erneut versuchen (`retry`), bis 24 h nach dem Speichern;
 *  - Liste geladen, Kamera fehlt (entfernt oder deaktiviert): verwerfen (`drop`).
 */
export function sceneReturnCamera(known: boolean, listLoaded: boolean): "restore" | "retry" | "drop" {
  if (known) return "restore";
  return listLoaded ? "drop" : "retry";
}

/**
 * Was auf der Platte steht: die laufenden Rueckkehr-Timer und die
 * wartenden Eintraege, deren Kamera noch nicht zu laden war. Eine laufende
 * Szene derselben Kamera hat Vorrang.
 */
export function sceneReturnsToSave(active: SavedSceneReturn[], waiting: SavedSceneReturn[]): SavedSceneReturn[] {
  const ids = new Set(active.map((r) => r.cameraId));
  return [...active, ...waiting.filter((r) => !ids.has(r.cameraId))];
}
