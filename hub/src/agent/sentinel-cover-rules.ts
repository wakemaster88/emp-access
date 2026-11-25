/**
 * Welche Kameras bewacht der Waechter mit Bildern gerade nachweislich? Die
 * Liste geht mit dem Lebenszeichen (Heartbeat, jede Minute) an die Cloud.
 * Die Cloud-Ueberwachung schweigt zu einer unbekannten Person an einer Kamera
 * nur, wenn die Sichtung selbst vom Hub belegt ist (vouchFor, `sentinel=1`
 * am Upload) und die Liste hoechstens 2 Minuten alt ist und die Kamera nennt
 * (src/lib/hub-sentinel.ts); dann meldet der Waechter. Gesperrte Personen
 * und Fahrzeuge meldet die Cloud weiter selbst. Reine Logik.
 *
 * Eine Kamera steht nur in der Liste, wenn alles zusammenkommt:
 *  - der Waechter mit Bildern ist eingeschaltet und ein Chat gekoppelt,
 *  - die Zustellung der Alarme an Telegram ist nicht gestoert
 *    (deliveryTrouble in outbox-rules.ts), und kein Neustart des Hubs steht
 *    an,
 *  - die Kamera ist nicht auf „aus“ und gerade bewacht (cameraWatched mit
 *    der Einstellung der Kamera, sentinelClosed und modeAlways),
 *  - der Waechter bewertet, was die Kamera gerade sieht, oder wuerde einen
 *    neuen Ausloeser dort sofort bewerten (cameraDuty),
 *  - das Bildmodell ist bereit; beantwortet es Aufrufe nicht, nur im
 *    Nachtfenster, denn nur dort geht der Alarm dann ungeprueft hinaus
 *    (onVisionError),
 *  - das Stundenlimit der Bewertungen ist nicht erreicht,
 *  - der Takt des Waechters lief vor hoechstens 30 s (coverageReport).
 * Fehlt etwas davon, fehlt die Kamera in der Liste, und die Cloud meldet wie
 * bisher. Im Zweifel melden beide.
 */
import { inQuietHours } from "./quiet.js";
import { HOUR_MS, cameraWatched, type InspectOutcome } from "./sentinel-rules.js";
import { modeAlways, sentinelClosed, type SentinelMode } from "./sentinel-mode-rules.js";

/**
 * Was der Waechter an einer Kamera gerade tut (cameraDuty). Nur bei
 * „bewertet“, „gemeldet“ und „frei“ steht die Kamera in der Liste.
 */
export type CameraDuty =
  /** Eine Bewertung laeuft fuer die Person, die die Kamera gerade sieht, seit hoechstens INSPECT_COVER_MAX_MS. */
  | "bewertet"
  /** Fuer die Person, die die Kamera gerade sieht, ging ein Alarm hinaus; gilt, solange danach die Sperrzeit laeuft. */
  | "gemeldet"
  /** Nichts offen: Ein neuer Ausloeser wuerde sofort bewertet. */
  | "frei"
  /**
   * Ein Personen-Ereignis dauert an, das keine laufende Bewertung abdeckt
   * (ohne Ausloeser, uebergangen, verfallen oder ohne Alarm bewertet), oder
   * die Bewertung laeuft laenger als INSPECT_COVER_MAX_MS ohne Ergebnis.
   */
  | "offen"
  /** Sperrzeit nach einer Bewertung: Ein neuer Ausloeser wuerde uebergangen. */
  | "gesperrt"
  /** Ein Ausloeser der Kamera wartet auf einen Platz. */
  | "wartet"
  /** Beide Plaetze fuer Bewertungen sind belegt: Ein neuer Ausloeser muesste warten. */
  | "kein_platz";

/**
 * So lange gilt eine Personen-Bewertung ohne Ergebnis als laufend
 * („bewertet“). Danach haengt sie vermutlich (Bildmodell, Kamera), und die
 * Kamera gilt als „offen“: Die Cloud meldet dort wieder selbst.
 */
export const INSPECT_COVER_MAX_MS = 5 * 60_000;

export interface DutyInput {
  now: number;
  /** Beginn des offenen Personen-Ereignisses der Kamera („PERSON erkannt“, noch nicht beendet); null = keins. */
  personSince: number | null;
  /** Letzte Bewertung eines Personen-Ausloesers der Kamera: Beginn und Ergebnis (null = laeuft); null = keine. */
  lastPerson: { at: number; outcome: InspectOutcome | null } | null;
  /** Ein neuer Ausloeser der Kamera wuerde jetzt wegen der Sperrzeit uebergangen (auch waehrend einer Bewertung). */
  locked: boolean;
  /** Fuer die Kamera wartet ein zurueckgestellter Ausloeser. */
  waiting: boolean;
  /** Ein Platz fuer eine weitere Bewertung ist frei. */
  slotFree: boolean;
}

/**
 * Was der Waechter an der Kamera gerade tut. Eine Personen-Bewertung gilt
 * der Person, die die Kamera gerade sieht, wenn sie nach dem Beginn des
 * offenen Personen-Ereignisses begann (oder keins offen ist). Ein Ereignis,
 * das so keine laufende Bewertung abdeckt, bringt keinen neuen Ausloeser:
 * „offen“, bis es endet. Endete seine Bewertung mit einem Alarm, gilt es
 * waehrend der Sperrzeit als gemeldet. Ohne offenes Ereignis zaehlt, ob ein
 * neuer Ausloeser sofort bewertet wuerde (Sperrzeit, wartender Ausloeser,
 * freier Platz). Eine Bewertung, die laenger als INSPECT_COVER_MAX_MS ohne
 * Ergebnis laeuft oder deren Beginn nach `now` liegt (Uhr zurueckgestellt),
 * deckt nichts ab: „offen“.
 */
export function cameraDuty(d: DutyInput): CameraDuty {
  const p = d.lastPerson;
  const open = d.personSince !== null;
  const current = p !== null && (d.personSince === null || p.at >= d.personSince);
  if (current && p.outcome === null) {
    const age = d.now - p.at;
    return age >= 0 && age <= INSPECT_COVER_MAX_MS ? "bewertet" : "offen";
  }
  // Ein Alarm aus der Zukunft (Uhr zurueckgestellt) belegt keine neue Person.
  if (open && current && p.outcome === "alarm" && d.locked && p.at <= d.now) return "gemeldet";
  if (open) return "offen";
  if (d.locked) return "gesperrt";
  if (d.waiting) return "wartet";
  return d.slotFree ? "frei" : "kein_platz";
}

/** Steht eine Kamera mit diesem Stand in der Liste fuer die Cloud? */
export function dutyCovers(duty: CameraDuty): boolean {
  return duty === "bewertet" || duty === "gemeldet" || duty === "frei";
}

/** Kurztext fuer das Log, warum eine bewachte Kamera nicht in der Liste steht. */
export const DUTY_TEXT: Record<CameraDuty, string> = {
  bewertet: "Bewertung läuft",
  gemeldet: "Alarm gesendet",
  frei: "bereit",
  offen: "Person ohne laufende Bewertung",
  gesperrt: "Sperrzeit nach der letzten Bewertung",
  wartet: "Auslöser wartet auf einen Platz",
  kein_platz: "beide Plätze für Bewertungen belegt",
};

export interface CoverCamera {
  id: number;
  mode: SentinelMode;
  /** Raum der Kamera geschlossen (cameraClosed); null = keine Betriebszeit bekannt. */
  roomClosed: boolean | null;
  /** Was der Waechter an der Kamera gerade tut (cameraDuty). */
  duty: CameraDuty;
}

export interface CoverInput {
  /** Der Waechter mit Bildern ist eingeschaltet (HUB_AGENT_SENTINEL nicht off). */
  enabled: boolean;
  /** Mindestens ein Chat ist gekoppelt: Ein Alarm hat einen Empfaenger. */
  paired: boolean;
  /**
   * Grund, aus dem ein Alarm des Waechters gerade nicht sicher hinausgeht:
   * Zustellung gestoert (alarmDeliveryTrouble) oder ein Neustart des Hubs
   * steht an. null = keiner.
   */
  delivery: string | null;
  /** Das Bildmodell ist bereit; sonst bewertet der Takt nichts. */
  visionReady: boolean;
  /** Gescheiterte Aufrufe des Bildmodells in Folge. */
  visionFailStreak: number;
  /** Bewertungen der letzten Stunde, ohne die vorgezogenen (wie das Stundenlimit sie zaehlt). */
  inspectionsLastHour: number;
  maxPerHour: number;
  /** HUB_AGENT_SENTINEL=always; gilt nur fuer Kameras „wie der Raum“ (modeAlways). */
  always: boolean;
  /** Ortszeit-Stunde; NaN, wenn sie nicht lesbar ist. */
  hour: number;
  nightWindow: string;
  cams: readonly CoverCamera[];
}

export interface Cover {
  /** Bewachte Kamera-IDs, aufsteigend. */
  cameras: number[];
  /** Warum keine Kamera in der Liste steht, obwohl der Waechter laeuft; null = kein solcher Grund. */
  blocked: string | null;
  /** Bewachte Kameras, die wegen ihres Stands nicht in der Liste stehen (cameraDuty), aufsteigend. */
  held: Array<{ id: number; duty: CameraDuty }>;
}

/** Bewertungen in der Stunde vor `now` (Beginnzeiten, wie planTick sie fuehrt). */
export function inspectionsInLastHour(starts: readonly number[], now: number): number {
  return starts.filter((t) => now - t <= HOUR_MS).length;
}

/** Die Kameras, die der Waechter gerade nachweislich bewacht. */
export function coveredCameras(i: CoverInput): Cover {
  const none = (blocked: string): Cover => ({ cameras: [], blocked, held: [] });
  if (!i.enabled) return none("Wächter aus");
  if (!i.paired) return none("kein Chat gekoppelt");
  if (i.delivery) return none(i.delivery);
  if (!i.visionReady) return none("Bildmodell nicht bereit");
  if (i.inspectionsLastHour >= i.maxPerHour) return none(`Stundenlimit von ${i.maxPerHour} Bewertungen erreicht`);
  if (i.visionFailStreak > 0 && !inQuietHours(i.nightWindow, i.hour)) return none("Bildmodell antwortet nicht");
  const watched = i.cams
    .filter((c) => {
      const closed = sentinelClosed(c.mode, c.roomClosed, i.hour);
      return closed !== "aus" && cameraWatched({ always: modeAlways(c.mode, i.always), closed, hour: i.hour, nightWindow: i.nightWindow });
    })
    .sort((a, b) => a.id - b.id);
  return {
    cameras: watched.filter((c) => dutyCovers(c.duty)).map((c) => c.id),
    blocked: null,
    held: watched.filter((c) => !dutyCovers(c.duty)).map((c) => ({ id: c.id, duty: c.duty })),
  };
}

/** So alt darf der letzte Takt des Waechters sein, damit seine Liste gemeldet wird. */
export const COVER_TICK_MAX_AGE_MS = 30_000;

/** Stand des letzten Takts: wann, und welche Kameras. */
export interface Coverage {
  at: number;
  cameras: readonly number[];
}

/**
 * Was das Lebenszeichen an die Cloud meldet: die Liste des letzten Takts mit
 * dessen Zeitpunkt. Lief der Takt laenger als COVER_TICK_MAX_AGE_MS nicht
 * (oder noch nie), ist die Liste leer: Dann meldet die Cloud wieder selbst.
 */
export function coverageReport(last: Coverage | null, now: number): { at: string; cameras: number[] } {
  const fresh = freshCoverage(last, now);
  if (!fresh) return { at: new Date(now).toISOString(), cameras: [] };
  return { at: new Date(fresh.at).toISOString(), cameras: [...fresh.cameras] };
}

/** Der Stand des letzten Takts, wenn er vor hoechstens COVER_TICK_MAX_AGE_MS lief (und nicht so weit in der Zukunft liegt); sonst null. */
function freshCoverage(last: Coverage | null, now: number): Coverage | null {
  return last !== null && now - last.at <= COVER_TICK_MAX_AGE_MS && last.at - now <= COVER_TICK_MAX_AGE_MS ? last : null;
}

/* ------------------------------------------------ Beleg je Sichtung (vouchFor) */

/** Was der Hub zu einer Personen-Sichtung an einer Kamera belegt (sentinel-vouch.ts). */
export interface Vouch {
  /** Der Waechter bewertet die Person, die die Kamera jetzt sieht, oder hat sie gemeldet: Nur dann darf die Cloud schweigen. */
  ok: boolean;
  /** Die Kamera steht in der frischen Liste des letzten Takts. */
  listed: boolean;
  /** Kurzer Grund fuer das Log. */
  why: string;
}

export interface VouchInput {
  /** Grund, aus dem die Liste gesperrt ist (Neustart steht an, holdSentinelCoverage); null = nicht gesperrt. */
  hold: string | null;
  /** Stand des letzten Takts; null = noch keiner. */
  last: Coverage | null;
  now: number;
  cameraId: number;
  /** Was der Waechter an der Kamera jetzt tut (cameraDuty mit dem Stand von jetzt, nicht dem des letzten Takts). */
  duty: CameraDuty;
}

/** Nur diese Staende belegen eine Sichtung: Die Bewertung laeuft, oder fuer diese Person ging ein Alarm hinaus. */
const VOUCHING: readonly CameraDuty[] = ["bewertet", "gemeldet"];

/**
 * Belegt der Hub, dass sein Waechter genau die Person bewertet, die die
 * Kamera jetzt sieht? Das geht als `sentinel=1` mit dem Upload der Sichtung
 * an die Cloud. Ein Beleg gilt nur, wenn alles zusammenkommt: Die Liste ist
 * nicht gesperrt, der letzte Takt lief vor hoechstens COVER_TICK_MAX_AGE_MS,
 * die Kamera steht in seiner Liste, und der Waechter bewertet die Person
 * gerade („bewertet“) oder hat fuer sie einen Alarm gesendet („gemeldet“).
 * „frei“ belegt nichts: Ein Ausloeser, der erst noch bewertet werden muesste,
 * kann noch uebergangen werden oder verfallen. Ohne Beleg meldet die Cloud
 * die Person selbst.
 */
export function vouchFor(i: VouchInput): Vouch {
  if (i.hold) return { ok: false, listed: false, why: `Liste gesperrt: ${i.hold}` };
  const fresh = freshCoverage(i.last, i.now);
  if (!fresh) return { ok: false, listed: false, why: "kein frischer Takt des Wächters" };
  if (!fresh.cameras.includes(i.cameraId)) return { ok: false, listed: false, why: "Kamera nicht in der Liste des Wächters" };
  if (!VOUCHING.includes(i.duty)) return { ok: false, listed: true, why: `keine Bewertung dieser Person (${DUTY_TEXT[i.duty]})` };
  return { ok: true, listed: true, why: DUTY_TEXT[i.duty] };
}

/**
 * HUB_SENTINEL_CLOUD_QUIET: Darf der Hub einen Beleg (`sentinel=1`) an die
 * Cloud schicken? Nur 1, on, true, ja oder yes schalten das ein; ab Werk aus.
 * Aus heisst: Die Cloud meldet unbekannte Personen nachts wie frueher selbst,
 * auch dort, wo der Waechter bewertet (im Zweifel melden beide).
 */
export function cloudQuietOn(raw: string | undefined): boolean {
  return /^(1|on|true|ja|yes)$/i.test((raw ?? "").trim());
}

/** Was der Upload einer Personen-Sichtung mitbringt: Beleg ja/nein, Zaehler und Zusatz fuer die Log-Zeile. */
export interface VouchParam {
  send: boolean;
  counter: string;
  note: string;
}

/**
 * Beleg fuer den Upload einer Sichtung (cameras.ts). `sentinel=1` geht nur
 * hinaus, wenn der Schalter an ist, der Waechter die Person belegt (vouchFor)
 * und die Gesichtserkennung des Hubs keinen Treffer der Gallery hat: Einen
 * Treffer prueft die Cloud selbst, und ist die Person dort nicht mehr aktiv,
 * meldet sie sie als unbekannt.
 */
export function vouchParam(v: Vouch, opts: { quietOn: boolean; galleryMatch: boolean }): VouchParam {
  if (opts.galleryMatch) return { send: false, counter: "sighting_sentinel_treffer", note: "" };
  if (v.ok && !opts.quietOn) {
    return { send: false, counter: "sighting_sentinel_beleg_aus", note: `; Beleg des Wächters (${v.why}), Stummschaltung der Cloud aus: Cloud meldet selbst` };
  }
  if (v.ok) return { send: true, counter: "sighting_sentinel_beleg", note: `; Beleg des Wächters: ${v.why}` };
  return v.listed
    ? { send: false, counter: "sighting_sentinel_gelistet_ohne_beleg", note: `; ohne Beleg, obwohl die Kamera in der Liste des Wächters steht (${v.why}): Cloud meldet selbst` }
    : { send: false, counter: "sighting_sentinel_ohne_beleg", note: "" };
}

/** Faellt eine Kamera aus der Liste? Dann geht das Lebenszeichen sofort hinaus. */
export function coverageShrank(prev: readonly number[], next: readonly number[]): boolean {
  const now = new Set(next);
  return prev.some((id) => !now.has(id));
}

/**
 * Log-Zeile, wenn sich die Liste aendert; null sonst. `prev` = null beim
 * ersten Takt: Dann gibt es eine Zeile nur, wenn die Liste nicht leer ist.
 * `quietOn` = HUB_SENTINEL_CLOUD_QUIET: Nur wenn der Schalter an ist, schweigt
 * die Cloud an den gemeldeten Kameras; sonst meldet sie dort weiter selbst.
 */
export function coverageLine(
  prev: readonly number[] | null,
  next: Cover,
  names: ReadonlyMap<number, string>,
  quietOn = true,
): string | null {
  const same = prev !== null && prev.length === next.cameras.length && prev.every((id, k) => id === next.cameras[k]);
  if (same || (prev === null && next.cameras.length === 0)) return null;
  const name = (id: number) => names.get(id) ?? `#${id}`;
  const held = next.held.map((h) => `${name(h.id)} – ${DUTY_TEXT[h.duty]}`).join("; ");
  if (!quietOn) {
    if (next.cameras.length === 0) {
      const why = next.blocked ?? held;
      return `Wächter: meldet der Cloud keine bewachte Kamera mehr${why ? ` (${why})` : ""}`;
    }
    return (
      `Wächter: meldet der Cloud ${next.cameras.length} bewachte Kamera(s): ` +
      next.cameras.map(name).join(", ") +
      (held ? ` (ohne laufende Bewertung: ${held})` : "") +
      " – die Cloud meldet unbekannte Personen weiter selbst (HUB_SENTINEL_CLOUD_QUIET aus)"
    );
  }
  if (next.cameras.length === 0) {
    const why = next.blocked ?? held;
    return `Wächter: Cloud meldet unbekannte Personen wieder an allen Kameras selbst${why ? ` (${why})` : ""}`;
  }
  return (
    `Wächter: meldet der Cloud ${next.cameras.length} bewachte Kamera(s) – unbekannte Personen dort nur noch über den Wächter: ` +
    next.cameras.map(name).join(", ") +
    (held ? ` (selbst meldet die Cloud an: ${held})` : "")
  );
}
