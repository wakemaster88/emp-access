/**
 * Reine Rollen-Regeln fuer Mandanten-Logins (ohne Datenbank, damit testbar).
 *
 * USER bedient (Tueren oeffnen, Schnappschuss holen, Ueberwachung scharf/
 * unscharf schalten), Konfiguration und Zugangsdaten bleiben ADMIN und
 * SUPER_ADMIN vorbehalten (siehe `isTenantAdminRole` in api-auth.ts).
 */

/** Felder einer Geraetezeile, die Zugangsdaten tragen. */
const DEVICE_SECRET_KEYS = ["apiToken", "shellyAuthKey"] as const;
type DeviceSecretKey = (typeof DEVICE_SECRET_KEYS)[number];

/**
 * Geraetezeile ohne Geraete-Token und Shelly-Schluessel. Beide braucht keine
 * Oberflaeche aus der API: das Token wird einmalig beim Erzeugen gezeigt,
 * den Shelly-Schluessel liest nur der Server.
 */
export function withoutDeviceSecrets<T extends object>(device: T): Omit<T, DeviceSecretKey> {
  const copy = { ...device } as Record<string, unknown>;
  for (const key of DEVICE_SECRET_KEYS) delete copy[key];
  return copy as Omit<T, DeviceSecretKey>;
}

/**
 * Hub-Auftraege, die auch USER anlegen darf: reine Bedienung aus der
 * Kamera-Ansicht (Schnappschuss holen, DoorBird-Tuer einmal oeffnen).
 * Alles andere (Neustart, Logs, Netzwerk-Scan, Schalten per IP, Tor offen
 * halten, Gesichter, Soundweb ...) verlangt eine Verwaltungs-Rolle.
 */
const USER_HUB_TASK_TYPES = new Set(["CAMERA_SNAPSHOT", "DOORBIRD_OPEN"]);

export function hubTaskAllowedForUser(type: unknown): boolean {
  return typeof type === "string" && USER_HUB_TASK_TYPES.has(type);
}

/**
 * Filter fuer die Auftragsliste in der Sitzung: USER sieht nur Auftraege der
 * Typen, die er selbst anlegen darf; die Verwaltung sieht alle.
 */
export function hubTaskListFilter(isAdmin: boolean): { type?: { in: string[] } } {
  return isAdmin ? {} : { type: { in: [...USER_HUB_TASK_TYPES] } };
}

/** Gespeicherter Stand der Ueberwachung, gegen den ein PATCH verglichen wird. */
export interface SurveillanceStored {
  scheduleEnabled: boolean;
  daysOfWeek: number;
  windowStart: string | null;
  windowEnd: string | null;
  cooldownMinutes: number;
  alertOnPerson: boolean;
  alertOnVehicle: boolean;
  alertTelegram: boolean;
  cameraIds: number[];
}

export interface SurveillancePatch {
  manualArmed?: boolean;
  scheduleEnabled?: boolean;
  daysOfWeek?: number;
  windowStart?: string | null;
  windowEnd?: string | null;
  cooldownMinutes?: number;
  alertOnPerson?: boolean;
  alertOnVehicle?: boolean;
  alertTelegram?: boolean;
  cameraIds?: number[];
}

/** Voreinstellung des Zeitfensters, wie GET /api/surveillance sie meldet. */
const DEFAULT_WINDOW_START = "22:00";
const DEFAULT_WINDOW_END = "08:00";

/**
 * Stand, solange noch nichts gespeichert ist. GET /api/surveillance meldet
 * genau diese Werte, und die Oberflaeche schickt sie beim Scharfschalten mit.
 */
export const SURVEILLANCE_DEFAULTS: SurveillanceStored = {
  scheduleEnabled: false,
  daysOfWeek: 127,
  windowStart: DEFAULT_WINDOW_START,
  windowEnd: DEFAULT_WINDOW_END,
  cooldownMinutes: 5,
  alertOnPerson: true,
  alertOnVehicle: true,
  alertTelegram: true,
  cameraIds: [],
};

function sameIds(a: number[], b: number[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

/**
 * true, wenn der PATCH mehr aendert als den manuellen Scharf-Schalter.
 *
 * Die Oberflaeche schickt beim Umschalten das ganze Formular mit; deshalb
 * zaehlt nur, was vom gespeicherten Stand abweicht. Ohne gespeicherte
 * Konfiguration (`stored` null) gilt der Vergleich mit den Voreinstellungen:
 * Scharfschalten bleibt Bedienung, jede Abweichung davon ist Verwaltung.
 */
export function surveillancePatchNeedsAdmin(
  patch: SurveillancePatch,
  saved: SurveillanceStored | null,
): boolean {
  const stored = saved ?? SURVEILLANCE_DEFAULTS;
  const differs = (key: Exclude<keyof SurveillanceStored, "cameraIds">, fallback?: string) => {
    const value = patch[key];
    if (value === undefined) return false;
    const current = stored[key];
    return fallback !== undefined ? (value ?? fallback) !== (current ?? fallback) : value !== current;
  };
  if (patch.cameraIds !== undefined && !sameIds(patch.cameraIds, stored.cameraIds)) return true;
  return (
    differs("scheduleEnabled") ||
    differs("daysOfWeek") ||
    differs("windowStart", DEFAULT_WINDOW_START) ||
    differs("windowEnd", DEFAULT_WINDOW_END) ||
    differs("cooldownMinutes") ||
    differs("alertOnPerson") ||
    differs("alertOnVehicle") ||
    differs("alertTelegram")
  );
}

/** Automatischer Oeffner einer gelisteten Person (Gesichtserkennung). */
export interface PersonOpener {
  triggerOnDetection: boolean;
  shellyDeviceId: number | null;
  shellyAction: string;
  timerSeconds: number | null;
}

/** Stand einer neu angelegten Person: kein automatischer Oeffner. */
export const PERSON_OPENER_DEFAULTS: PersonOpener = {
  triggerOnDetection: false,
  shellyDeviceId: null,
  shellyAction: "ON",
  timerSeconds: null,
};

/**
 * true, wenn die Anfrage den automatischen Oeffner einer Person setzt oder
 * aendert. Personen benennen und Sichtungen zuordnen bleibt Bedienung; eine
 * dauerhafte Freigabe, die bei Erkennung ein Relais schaltet, ist Verwaltung.
 */
export function personOpenerChangeNeedsAdmin(
  patch: Partial<{ [K in keyof PersonOpener]: PersonOpener[K] | null | undefined }>,
  stored: PersonOpener,
): boolean {
  const keys = Object.keys(PERSON_OPENER_DEFAULTS) as Array<keyof PersonOpener>;
  return keys.some((key) => {
    const value = patch[key];
    if (value === undefined) return false;
    return (value ?? null) !== (stored[key] ?? null);
  });
}

/** Hat die Person einen automatischen Oeffner (Relais bei Erkennung)? */
export function personHasOpener(person: Pick<PersonOpener, "triggerOnDetection" | "shellyDeviceId">): boolean {
  return person.triggerOnDetection || person.shellyDeviceId != null;
}

/**
 * true, wenn die Anfrage bei einer Person MIT Oeffner aendert, wann er
 * ausloest: die Person wieder aktivieren oder an eine andere Kamera haengen.
 * Auch das ist Verwaltung, obwohl die Oeffner-Felder selbst gleich bleiben.
 */
export function personOpenerScopeChangeNeedsAdmin(
  patch: { isActive?: boolean; cameraId?: number | null },
  stored: Pick<PersonOpener, "triggerOnDetection" | "shellyDeviceId"> & { isActive: boolean; cameraId: number | null },
): boolean {
  if (!personHasOpener(stored)) return false;
  if (patch.isActive === true && !stored.isActive) return true;
  return patch.cameraId !== undefined && (patch.cameraId ?? null) !== (stored.cameraId ?? null);
}
