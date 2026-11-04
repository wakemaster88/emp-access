/**
 * Mammotion-Maehroboter (Device.type = MAMMOTION_MOWER).
 *
 * Die Maeher haengen an der Mammotion-Cloud, nicht im LAN. Der Hub spricht
 * ueber seinen Maeher-Dienst (hub/mower, PyMammotion) mit ihnen, meldet
 * Zustand und Karte an `POST /api/hub/mower-sync` und fuehrt Befehle aus der
 * Cloud als Hub-Task `MOWER_ACTION` aus.
 *
 *  - Zustand:  `Device.systemInfo`  (MowerState, bei jeder Aenderung)
 *  - Karte:    `Device.mowerMap`    (MowerMap, selten, in Bildkoordinaten)
 *  - Kennung:  `Device.mowerName`   (Geraetename bei Mammotion)
 */

export const MOWER_ACTIONS = ["start_task", "pause", "resume", "stop", "dock"] as const;
export type MowerAction = (typeof MOWER_ACTIONS)[number];

export function isMowerAction(v: unknown): v is MowerAction {
  return typeof v === "string" && (MOWER_ACTIONS as readonly string[]).includes(v);
}

export interface MowerTaskView {
  id: string;
  name: string;
  enabled: boolean;
  running: boolean;
  startTime: string;
  endTime: string;
  /** Kurz und deutsch: "Mo", "Di", … "So". */
  weekdays: string[];
  bladeHeightMm: number | null;
  zones: string[];
}

export interface MowerState {
  model: string;
  label: string;
  online: boolean;
  /** WorkMode-Name von PyMammotion, z. B. "MODE_WORKING". */
  status: string;
  statusLabel: string;
  active: boolean;
  charging: boolean;
  battery: number | null;
  progress: number | null;
  currentZone: string | null;
  runningTaskId: string | null;
  firmware: string | null;
  position: { lat: number; lon: number } | null;
  zones: string[];
  tasks: MowerTaskView[];
  errors: { code: number; text: string }[];
  /** Zeitpunkt der Meldung durch den Hub (ISO). */
  at: string;
}

/**
 * Karte in Bildkoordinaten (Breite `w`, Hoehe `h`). Punkte als SVG-Punktliste
 * "x,y x,y …". `proj` rechnet eine GPS-Position in dieselben Koordinaten um,
 * damit die Live-Position ohne neue Karte wandern kann:
 *   x = (lon * kx - minX) * scale + offX,  y = h - ((lat - minY) * scale + offY)
 */
export interface MowerMap {
  v: 1;
  w: number;
  h: number;
  areas: { name: string; pts: string }[];
  obstacles: string[];
  paths: string[];
  dock: [number, number] | null;
  proj: { kx: number; minX: number; minY: number; scale: number; offX: number; offY: number } | null;
}

const MODES_WORKING = new Set(["MODE_WORKING"]);
const MODES_PAUSED = new Set(["MODE_PAUSE", "MODE_CHARGING_PAUSE"]);
const MODES_RETURNING = new Set(["MODE_RETURNING"]);

export type MowerTone = "mowing" | "paused" | "returning" | "charging" | "idle" | "error" | "offline";

/** Grobe Lage fuer Farbe und Symbol. */
export function mowerTone(s: Pick<MowerState, "online" | "status" | "charging" | "errors">): MowerTone {
  if (!s.online) return "offline";
  if (s.errors.length > 0) return "error";
  if (MODES_WORKING.has(s.status)) return "mowing";
  if (MODES_PAUSED.has(s.status)) return "paused";
  if (MODES_RETURNING.has(s.status)) return "returning";
  if (s.charging) return "charging";
  return "idle";
}

/* ------------------------------------------------------------- Bereinigen */

const str = (v: unknown, max = 80): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

function point(v: unknown): { lat: number; lon: number } | null {
  if (!v || typeof v !== "object") return null;
  const p = v as { lat?: unknown; lon?: unknown };
  const lat = num(p.lat, -90, 90);
  const lon = num(p.lon, -180, 180);
  return lat != null && lon != null && (lat !== 0 || lon !== 0) ? { lat, lon } : null;
}

/** Zustand aus dem Hub-Payload; unbrauchbare Felder fallen weg. */
export function sanitizeMowerState(raw: unknown, at: Date): MowerState | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const tasks = Array.isArray(m.tasks) ? m.tasks.slice(0, 40) : [];
  const errors = Array.isArray(m.errors) ? m.errors.slice(0, 10) : [];
  const zones = Array.isArray(m.zones) ? m.zones.slice(0, 60) : [];
  return {
    model: str(m.model, 40),
    label: str(m.label, 80),
    online: m.online === true,
    status: str(m.status, 40),
    statusLabel: str(m.statusLabel, 60),
    active: m.active === true,
    charging: m.charging === true,
    battery: num(m.battery, 0, 100),
    progress: num(m.progress, 0, 100),
    currentZone: str(m.currentZone, 80) || null,
    runningTaskId: str(m.runningTaskId, 40) || null,
    firmware: str(m.firmware, 40) || null,
    position: point(m.position),
    zones: zones
      .map((z) => (typeof z === "string" ? z : z && typeof z === "object" ? (z as { name?: unknown }).name : ""))
      .map((z) => str(z, 80))
      .filter(Boolean),
    tasks: tasks.flatMap((t): MowerTaskView[] => {
      if (!t || typeof t !== "object") return [];
      const x = t as Record<string, unknown>;
      const id = str(x.id, 40);
      if (!id) return [];
      return [
        {
          id,
          name: str(x.name, 80) || "Aufgabe",
          enabled: x.enabled === true,
          running: x.running === true,
          startTime: str(x.startTime, 8),
          endTime: str(x.endTime, 8),
          weekdays: Array.isArray(x.weekdays) ? x.weekdays.map((d) => str(d, 3)).filter(Boolean).slice(0, 7) : [],
          bladeHeightMm: num(x.bladeHeightMm, 0, 200),
          zones: Array.isArray(x.zones) ? x.zones.map((z) => str(z, 80)).filter(Boolean).slice(0, 30) : [],
        },
      ];
    }),
    errors: errors.flatMap((e) => {
      if (!e || typeof e !== "object") return [];
      const x = e as { code?: unknown; text?: unknown };
      const code = num(x.code, 0, 1e9);
      return code == null ? [] : [{ code, text: str(x.text, 200) }];
    }),
    at: at.toISOString(),
  };
}

const PTS_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?( -?\d+(\.\d+)?,-?\d+(\.\d+)?)*$/;
const MAX_PTS_CHARS = 60_000;

function pts(v: unknown): string | null {
  if (typeof v !== "string" || v.length > MAX_PTS_CHARS) return null;
  const t = v.trim();
  return PTS_RE.test(t) ? t : null;
}

/** Karte aus dem Hub-Payload pruefen (nur Zahlen, begrenzte Groesse). */
export function sanitizeMowerMap(raw: unknown): MowerMap | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const w = num(m.w, 10, 4000);
  const h = num(m.h, 10, 4000);
  if (w == null || h == null) return null;
  const areas = Array.isArray(m.areas) ? m.areas.slice(0, 60) : [];
  const projRaw = m.proj && typeof m.proj === "object" ? (m.proj as Record<string, unknown>) : null;
  const projNums = projRaw
    ? (["kx", "minX", "minY", "scale", "offX", "offY"] as const).map((k) => {
        const n = projRaw[k];
        return typeof n === "number" && Number.isFinite(n) ? n : null;
      })
    : null;
  const dock = Array.isArray(m.dock) && m.dock.length === 2 ? m.dock.map((n) => num(n, -10, 5000)) : null;
  return {
    v: 1,
    w,
    h,
    areas: areas.flatMap((a) => {
      if (!a || typeof a !== "object") return [];
      const x = a as { name?: unknown; pts?: unknown };
      const p = pts(x.pts);
      return p ? [{ name: str(x.name, 80), pts: p }] : [];
    }),
    obstacles: (Array.isArray(m.obstacles) ? m.obstacles.slice(0, 200) : []).map(pts).filter((p): p is string => !!p),
    paths: (Array.isArray(m.paths) ? m.paths.slice(0, 200) : []).map(pts).filter((p): p is string => !!p),
    dock: dock && dock[0] != null && dock[1] != null ? [dock[0], dock[1]] : null,
    proj:
      projNums && projNums.every((n) => n != null)
        ? {
            kx: projNums[0]!,
            minX: projNums[1]!,
            minY: projNums[2]!,
            scale: projNums[3]!,
            offX: projNums[4]!,
            offY: projNums[5]!,
          }
        : null,
  };
}

/** Gespeicherten Zustand lesen (systemInfo ist Json). */
export function readMowerState(v: unknown): MowerState | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<MowerState>;
  if (typeof s.status !== "string" || !Array.isArray(s.tasks) || !Array.isArray(s.errors)) return null;
  return {
    zones: [],
    position: null,
    ...s,
  } as MowerState;
}

export function readMowerMap(v: unknown): MowerMap | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Partial<MowerMap>;
  return m.v === 1 && typeof m.w === "number" && typeof m.h === "number" && Array.isArray(m.areas) ? (m as MowerMap) : null;
}

/** GPS-Position in Kartenkoordinaten. */
export function projectOnMap(map: MowerMap, p: { lat: number; lon: number } | null): [number, number] | null {
  if (!p || !map.proj) return null;
  const { kx, minX, minY, scale, offX, offY } = map.proj;
  const x = (p.lon * kx - minX) * scale + offX;
  const y = map.h - ((p.lat - minY) * scale + offY);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -20 || y < -20 || x > map.w + 20 || y > map.h + 20) return null;
  return [x, y];
}

/* -------------------------------------------------------- Naechste Mahd */

const WEEKDAY_INDEX: Record<string, number> = { So: 0, Mo: 1, Di: 2, Mi: 3, Do: 4, Fr: 5, Sa: 6 };
const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** Wochentag und Minuten seit Mitternacht in der Zeitzone des Mandanten. */
function localNow(nowMs: number, timezone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day: Math.max(0, day), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/**
 * Naechster Start einer aktiven Aufgabe: "heute 20:00", "morgen 20:00" oder
 * "Do 20:00". `null`, wenn keine Aufgabe einen Wochentag und eine Uhrzeit hat.
 */
export function nextMowing(
  tasks: MowerTaskView[],
  nowMs: number,
  timezone: string,
): { task: MowerTaskView; label: string; inDays: number } | null {
  const now = localNow(nowMs, timezone);
  let best: { task: MowerTaskView; label: string; inDays: number; score: number } | null = null;
  for (const t of tasks) {
    if (!t.enabled) continue;
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.startTime);
    if (!m) continue;
    const start = Number(m[1]) * 60 + Number(m[2]);
    const days = t.weekdays.map((d) => WEEKDAY_INDEX[d]).filter((d): d is number => d != null);
    for (let ahead = 0; ahead <= 7; ahead++) {
      const day = (now.day + ahead) % 7;
      if (!days.includes(day)) continue;
      if (ahead === 0 && start <= now.minutes) continue;
      const score = ahead * 1440 + start;
      if (!best || score < best.score) {
        const when = ahead === 0 ? "heute" : ahead === 1 ? "morgen" : WEEKDAY_SHORT[day];
        best = { task: t, label: `${when} ${t.startTime}`, inDays: ahead, score };
      }
      break;
    }
  }
  return best ? { task: best.task, label: best.label, inDays: best.inDays } : null;
}

/** "Di, Do, Sa" bzw. "täglich". */
export function weekdaysLabel(days: string[]): string {
  if (days.length === 7) return "täglich";
  const order = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  return [...days].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(", ");
}
