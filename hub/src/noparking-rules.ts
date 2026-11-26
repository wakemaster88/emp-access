/**
 * Reine Regeln des Halteverbots (ohne I/O, testbar): welche Fahrzeug-Boxen
 * zählen, wie Boxen über die Zeit demselben Fahrzeug zugeordnet werden, wann
 * ein Fahrzeug fällig ist und wann angesagt werden darf. Kamera, Tracker,
 * Cloud und Lautsprecher stehen in noparking.ts; die Einstellungen kommen als
 * Parameter.
 */
import { inside, type Point } from "./zone-rules.js";

/** Fahrzeug-Box vom Tracker, Koordinaten normiert 0..1 (wie VehicleBox in vision.ts). */
export interface NoParkBox {
  cls: number;
  conf: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** COCO-Klassen: 2 Auto, 3 Motorrad, 5 Bus, 7 Lastwagen. */
export const VEHICLE_CLASSES: ReadonlySet<number> = new Set([2, 3, 5, 7]);

/**
 * Mindestgröße einer Box, Anteil an der Bildfläche. Deutlich kleiner als
 * HUB_VEHICLE_MIN_AREA (2 %, gedacht für Autos direkt an der Einfahrt): Auf
 * dem Schotter am Eingang belegt ein Pkw rund 1,4 %, die Autos auf dem
 * Parkplatz im Hintergrund nur 0,1–0,3 %. Dazwischen liegt diese Schwelle.
 */
export const DEFAULT_MIN_AREA = 0.005;
export const DEFAULT_MIN_CONF = 0.35;
/** Zwei Boxen gelten als dasselbe Fahrzeug ab dieser Überdeckung. */
export const SAME_VEHICLE_IOU = 0.4;
/** Doppelerkennung: YOLO meldet denselben Transporter gern als Auto und Lastwagen. */
export const DUPLICATE_IOU = 0.6;
/**
 * Aussetzer überbrücken: Ein Fahrzeug kann kurz verdeckt sein (Passant,
 * Lieferwagen davor) oder in einem Bild übersehen werden. Erst nach so vielen
 * Durchläufen ohne Treffer gilt es als weggefahren.
 */
export const MAX_MISSES = 3;

/* ---------------------------------------------------------------------------
 * Boxen vergleichen
 * ------------------------------------------------------------------------- */

/** Überdeckung zweier Boxen (Schnittfläche durch Vereinigung). */
export function overlap(a: NoParkBox, b: NoParkBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const shared = (x2 - x1) * (y2 - y1);
  const union = a.w * a.h + b.w * b.h - shared;
  return union > 0 ? shared / union : 0;
}

/**
 * Radaufstandspunkt: Mitte der Unterkante. Geprüft wird er, nicht der
 * Mittelpunkt: Ein hoher Transporter neben der Fläche würde mit seinem
 * Mittelpunkt hineinragen, steht aber mit den Rädern daneben.
 */
export function footPoint(b: NoParkBox): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h };
}

export interface BoxFilter {
  /** HUB_NOPARK_MIN_CONF, Standard DEFAULT_MIN_CONF. */
  minConf: number;
  /** HUB_NOPARK_MIN_AREA, Standard DEFAULT_MIN_AREA. */
  minArea: number;
}

/**
 * Boxen, die ein Fahrzeug in der Fläche verdecken können: groß und sicher
 * genug wie in relevantBoxes, der Fußpunkt aber auch außerhalb der Fläche –
 * ein Lieferwagen auf der Straße davor steht mit den Rädern daneben. Die
 * kleinen Autos auf dem Parkplatz dahinter zählen nicht.
 */
export function coverBoxes<B extends NoParkBox>(boxes: B[], cfg: BoxFilter): B[] {
  return boxes.filter((b) => VEHICLE_CLASSES.has(b.cls) && b.conf >= cfg.minConf && b.w * b.h >= cfg.minArea);
}

/** Boxen in der Fläche, groß genug, ohne Doppelerkennungen; die sicherste zuerst. */
export function relevantBoxes<B extends NoParkBox>(boxes: B[], zone: Point[], cfg: BoxFilter): B[] {
  const candidates = boxes
    .filter(
      (b) =>
        VEHICLE_CLASSES.has(b.cls) &&
        b.conf >= cfg.minConf &&
        b.w * b.h >= cfg.minArea &&
        inside(footPoint(b), zone),
    )
    .sort((a, b) => b.conf - a.conf);

  const kept: B[] = [];
  for (const box of candidates) {
    if (!kept.some((k) => overlap(k, box) >= DUPLICATE_IOU)) kept.push(box);
  }
  return kept;
}

/* ---------------------------------------------------------------------------
 * Was gerade steht
 * ------------------------------------------------------------------------- */

/**
 * Dasselbe Fahrzeug: Taucht an der Stelle eines bekannten Fahrzeugs
 * (Überdeckung ab SAME_VEHICLE_IOU) wieder eine Box auf, übernimmt sie seine
 * Spur ganz – erste Sichtung, Meldung, Eintrag in der Historie, Ansagen –,
 * solange die Stelle höchstens so lange beobachtet leer war (verdeckt, also
 * von einer anderen Box überdeckt, zählt nicht als leer; verdeckt aber
 * höchstens LOST_MEMORY_MS beobachtet, sameVehicle) …
 */
export const SAME_VEHICLE_GAP_MS = 3 * 60_000;
/**
 * … oder höchstens so viele Prüfungen in Folge leer waren: Nachts (Takt 120 s)
 * oder bei langem HUB_NOPARK_INTERVAL machen ein, zwei Fehlerkennungen aus
 * einem stehenden Fahrzeug kein neues. War die Stelle länger beobachtet leer,
 * ist eine Box dort ein neues Fahrzeug mit eigener Standzeit, eigener Meldung
 * und eigener Episode.
 */
export const SAME_VEHICLE_MAX_EMPTY_CHECKS = 2;
/**
 * Längster Abstand zweier Prüfungen, der als durchgehend beobachtet gilt
 * (längster Standard-Takt 120 s plus ein hängender Durchlauf, aufgerundet);
 * bei längerem Takt mehr (observedGapLimitMs). Ein längerer Abstand – Hub
 * aus, Mac im Ruhezustand, Uhr gesprungen – zählt nicht als leer, ebenso eine
 * Prüfung ohne Ergebnis (noteBlind).
 */
export const OBSERVED_GAP_MAX_MS = 5 * 60_000;
/** Bei langem Takt (HUB_NOPARK_INTERVAL) gilt als beobachtet bis zu so viel mal dem längsten Takt. */
export const OBSERVED_GAP_FACTOR = 2.5;

/**
 * Längster beobachteter Abstand bei diesem längsten eingestellten Takt:
 * mindestens OBSERVED_GAP_MAX_MS, sonst OBSERVED_GAP_FACTOR mal der Takt.
 * Sonst zählte bei einem Takt über 5 Minuten keine Prüfung als leer, und
 * eine Episode endete nie.
 */
export function observedGapLimitMs(longestCheckMs: number): number {
  return Number.isFinite(longestCheckMs) ? Math.max(OBSERVED_GAP_MAX_MS, OBSERVED_GAP_FACTOR * longestCheckMs) : OBSERVED_GAP_MAX_MS;
}
/**
 * So lange nach der letzten Sichtung bleibt ein gemeldetes Fahrzeug gemerkt,
 * auch über einen Ausfall von Kamera, Tracker oder Hub hinweg (im Speicher
 * und in hub/.cache/noparking.json): Steht es danach noch an derselben
 * Stelle, ist es dasselbe – keine zweite Ansage, keine zweite erste
 * Nachricht, kein zweites Bild. Länger als die Folge der Erinnerungen
 * (120 Minuten nach der ersten Nachricht).
 */
export const REPORTED_MEMORY_MS = 3 * 60 * 60_000;
/**
 * So lange nach der letzten Sichtung bleibt ein noch nicht gemeldetes
 * Fahrzeug gemerkt (nach einem Ausfall), ebenso die Stelle eines
 * weggefahrenen Fahrzeugs für die Diagnose (reacquired_new). Ebenso lange
 * beobachtet (nicht nach der Uhr) gilt die engere Wiedererkennung
 * (SAME_SPOT_IOU) und höchstens so lange verdeckt die lockere (sameVehicle).
 */
export const LOST_MEMORY_MS = 15 * 60_000;
/**
 * Engere Wiedererkennung eines schon gemeldeten Fahrzeugs der laufenden
 * Episode: Taucht bis LOST_MEMORY_MS beobachtete Zeit nach seiner letzten
 * Sichtung (Zeiten ohne Beobachtung zählen nicht, dieselbe Uhr wie bei
 * sameVehicle) eine Box mit mindestens dieser Überdeckung zu seiner letzten
 * Box auf, ist es dasselbe, auch nach längerer beobachteter Leere (die
 * Erkennung setzt etwa in der Dämmerung aus) – Standzeit, Meldung, Eintrag,
 * Ansagen und Episode laufen weiter. Ein anderes Fahrzeug, das genau dort
 * hält, gilt damit bewusst als dasselbe. Mit geringerer Überdeckung
 * (SAME_VEHICLE_IOU) gilt es nur nach kurzer Lücke als dasselbe
 * (sameVehicleGap).
 */
export const SAME_SPOT_IOU = 0.75;

export interface Standing {
  /**
   * Kennung des Fahrzeugs, eindeutig je Kamera (erste Sichtung und laufende
   * Nummer im Durchlauf); sie steht im gesicherten Zustand und bleibt über
   * einen Neustart. Daraus entsteht der Schlüssel seines Eintrags in der
   * Historie (reportKeys).
   */
  id: string;
  box: NoParkBox;
  firstSeenAt: number;
  lastSeenAt: number;
  /** Prüfungen in Folge ohne Treffer, auch verdeckte – nach MAX_MISSES reißt die Spur ab. */
  misses: number;
  /**
   * Beobachtete Leerzeit seit der letzten Sichtung: Zeiten ohne Beobachtung
   * zählen nicht, ebenso Prüfungen, in denen eine andere Box die Box des
   * Fahrzeugs überdeckt (Verdeckung zählt nicht als leer).
   */
  missedMs: number;
  /** Leere Prüfungen seit der letzten Sichtung (ohne Treffer und nicht verdeckt, wie missedMs). */
  emptyChecks: number;
  /**
   * Beobachtete Zeit seit der letzten Sichtung, leer oder verdeckt (Zeiten
   * ohne Beobachtung zählen nicht): die Uhr der engeren Wiedererkennung
   * (sameSpotCandidate). Der verdeckte Teil (unseenMs − missedMs) begrenzt
   * die lockere (sameVehicle): Nach LOST_MEMORY_MS verdeckt ist es nicht mehr
   * dasselbe, auch wenn eine überlappende Nachbar-Box seine Leere anhält.
   */
  unseenMs: number;
  /** Zeitpunkt der Meldung: wann die Standzeit die Schwelle erreichte (0 = noch nicht). */
  reportedAt: number;
  /** Eintrag in der Historie mit Bild zugestellt (oder nach MAX_REPORT_TRIES aufgegeben). */
  stored: boolean;
  /** Gescheiterte Versuche für den Eintrag in der Historie. */
  storeTries: number;
  /**
   * Schlüssel des Eintrags in der Historie, festgelegt beim ersten Versuch
   * (null = noch keiner). Jeder weitere Versuch trägt denselben; ein später
   * fälliges Fahrzeug bekommt einen eigenen.
   */
  storeKey: string | null;
  /** Ansagen für dieses Fahrzeug (höchstens SPEAKS_PER_VEHICLE). */
  speaks: number;
  /** Letzte Ansage für dieses Fahrzeug (0 = keine). */
  spokeAt: number;
}

/** Abgerissene Spur (MAX_MISSES Aussetzer oder zu lange beobachtet fort). */
export interface LostVehicle extends Standing {
  lostAt: number;
  /**
   * Länger beobachtet fort, als für dasselbe Fahrzeug gilt (sameVehicle):
   * Eine Box an der Stelle ist ein neues Fahrzeug. Gemerkt nur noch für einen
   * offenen Eintrag in der Historie und die Diagnose.
   */
  gone: boolean;
}

/**
 * Episode: Zeit, in der die Fläche belegt ist. Sie beginnt nur, wenn ein
 * Fahrzeug fällig wird. War die Fläche danach länger beobachtet leer, als für
 * dasselbe Fahrzeug gilt (sameVehicleGap), wartet sie nur noch auf ihre
 * gemeldeten Fahrzeuge (vacated): Sie endet erst, wenn keines mehr
 * wiedererkannt werden kann, weder locker (sameVehicle, etwa solange es
 * verdeckt ist) noch an seiner Stelle (SAME_SPOT_IOU), oder wenn vorher ein
 * neues Fahrzeug fällig wird – es beginnt eine eigene. Ist ein gemeldetes
 * Fahrzeug wieder zu sehen, ist die Fläche wieder belegt und sie läuft
 * weiter. Nachrichten (Push, Telegram) gelten der Episode, nicht dem
 * einzelnen Fahrzeug; zu ihr gehört jedes Fahrzeug, das seit ihrem Beginn
 * gemeldet wurde (inEpisode).
 */
export interface Episode {
  startedAt: number;
  /** Erste Nachricht hinausgegangen (0 = noch nicht, etwa in der Nacht). */
  firstAt: number;
  /** Erinnerungen erledigt (gesendet oder in der Nacht entfallen), 0 bis 3. */
  reminders: number;
  /** Gescheiterte Versuche der fälligen Nachricht. */
  tries: number;
  /** Fläche war zu lange beobachtet leer: Die Episode wartet nur noch auf ihre Fahrzeuge (fehlt = nein). */
  vacated?: true;
}

/** Gehört `s` zur Episode `ep`? Gemeldet seit ihrem Beginn. */
export function inEpisode(ep: Episode, s: Standing): boolean {
  return s.reportedAt > 0 && s.reportedAt >= ep.startedAt;
}

export interface TrackState {
  standing: Standing[];
  lost: LostVehicle[];
  episode: Episode | null;
  /** Letzte Ansage an dieser Kamera (0 = keine). */
  lastSpeakAt: number;
  /** Gescheiterte Meldung: der nächste Versuch frühestens dann (0 = sofort, retryDelayMs). */
  retryAt: number;
  /** Letzte Prüfung mit Ergebnis (0 = keine); nicht gesichert. */
  lastCheckAt: number;
  /** Seit lastCheckAt gab es eine Prüfung ohne Ergebnis oder einen Neustart: Die Zeit zählt nicht als leer. */
  blind: boolean;
  /** Beobachtete Leerzeit der Fläche seit der letzten Box … */
  emptyMs: number;
  /** … und leere Prüfungen in Folge (beide stehen still, sobald sie zu lang sind: Episode.vacated). */
  emptyChecks: number;
}

export function emptyTrackState(): TrackState {
  return { standing: [], lost: [], episode: null, lastSpeakAt: 0, retryAt: 0, lastCheckAt: 0, blind: false, emptyMs: 0, emptyChecks: 0 };
}

export function newStanding(box: NoParkBox, now: number, id = `${now}-0`): Standing {
  return {
    id,
    box,
    firstSeenAt: now,
    lastSeenAt: now,
    misses: 0,
    missedMs: 0,
    emptyChecks: 0,
    unseenMs: 0,
    reportedAt: 0,
    stored: false,
    storeTries: 0,
    storeKey: null,
    speaks: 0,
    spokeAt: 0,
  };
}

export interface TrackResult {
  /** Neue Spuren. */
  added: number;
  /** Spuren, die in diesem Durchlauf abrissen. */
  lost: number;
  /** Wiedergefundene Spuren (dasselbe Fahrzeug, Übernahme der Spur). */
  reacquired: number;
  /** Neue Spuren an der Stelle eines Fahrzeugs, das zu lange beobachtet fort war. */
  replaced: number;
  /** Spuren, die in diesem Durchlauf zu lange beobachtet fort waren (weggefahren). */
  left: number;
  /** Kennungen der Fahrzeuge, die nur die engere Wiedererkennung (SAME_SPOT_IOU) als dieselben erkannte. */
  tight: string[];
  /** Die Episode endet mit diesem Durchlauf (keines ihrer Fahrzeuge kann mehr zurückkommen). */
  episodeEnded: boolean;
}

/**
 * Noch dasselbe Fahrzeug nach `missedMs` beobachteter Leerzeit und
 * `emptyChecks` leeren Prüfungen? Höchstens SAME_VEHICLE_GAP_MS oder
 * höchstens SAME_VEHICLE_MAX_EMPTY_CHECKS Prüfungen.
 */
export function sameVehicleGap(missedMs: number, emptyChecks: number): boolean {
  return missedMs <= SAME_VEHICLE_GAP_MS || emptyChecks <= SAME_VEHICLE_MAX_EMPTY_CHECKS;
}

/**
 * Noch dasselbe Fahrzeug (lockere Übernahme, SAME_VEHICLE_IOU), wenn jetzt
 * `extraMs` beobachtete Zeit hinzukommt (sie zählt als leer)? Kurze
 * unverdeckte Leere (sameVehicleGap) und höchstens LOST_MEMORY_MS beobachtet
 * verdeckt (unseenMs − missedMs): Sonst bliebe ein weggefahrenes Fahrzeug,
 * dessen Box ein stehender Nachbar überlappt, beliebig lange übernehmbar.
 * Danach greift an seiner Stelle nur noch die engere Wiedererkennung
 * (sameSpotCandidate). Die Leere allein begrenzt nur sameVehicleGap: Bei
 * langem Takt machen ein, zwei Fehlerkennungen kein neues Fahrzeug.
 */
export function sameVehicle(s: Pick<Standing, "missedMs" | "emptyChecks" | "unseenMs">, extraMs = 0): boolean {
  return sameVehicleGap(s.missedMs + extraMs, s.emptyChecks) && s.unseenMs - s.missedMs <= LOST_MEMORY_MS;
}

/**
 * Beobachtete Zeit seit der letzten Prüfung mit Ergebnis: 0 nach einer
 * Prüfung ohne Ergebnis oder einem Neustart (blind), bei der ersten Prüfung,
 * bei einer rückwärts gesprungenen Uhr und bei mehr als `limitMs`
 * (observedGapLimitMs des längsten Takts).
 */
export function observedGapMs(state: TrackState, now: number, limitMs = OBSERVED_GAP_MAX_MS): number {
  if (state.blind || state.lastCheckAt <= 0) return 0;
  const gap = now - state.lastCheckAt;
  return gap > 0 && gap <= limitMs ? gap : 0;
}

/**
 * Prüfung ohne Ergebnis (Tracker weg, Kamera nicht in Grundstellung, Fehler,
 * hängender Durchlauf): Die Zeit bis zur nächsten Prüfung mit Ergebnis zählt
 * nicht als leer.
 */
export function noteBlind(state: TrackState): void {
  state.blind = true;
}

/** Offener Eintrag in der Historie (gemeldet, nicht zugestellt, Versuche übrig)? */
function storePending(s: Standing): boolean {
  return s.reportedAt > 0 && !s.stored && s.storeTries < MAX_REPORT_TRIES;
}

/**
 * Wie lange nach der letzten Sichtung ein Fahrzeug gemerkt bleibt
 * (REPORTED_MEMORY_MS, LOST_MEMORY_MS): ein gemeldetes, solange es
 * wiederkommen kann (auch nur noch an seiner Stelle der Episode `ep`, nach
 * beobachteter Zeit) oder sein Eintrag offen ist.
 */
function memoryMs(s: Standing, gone: boolean, ep: Episode | null): number {
  return s.reportedAt > 0 && (!gone || storePending(s) || sameSpotCandidate(ep, s, 0)) ? REPORTED_MEMORY_MS : LOST_MEMORY_MS;
}

/** Beste Box zu `box` ab `minIou` (Standard SAME_VEHICLE_IOU), -1 = keine. */
function bestMatch(box: NoParkBox, boxes: NoParkBox[], minIou = SAME_VEHICLE_IOU): number {
  let bestIdx = -1;
  let bestScore = minIou;
  for (let i = 0; i < boxes.length; i++) {
    const score = overlap(box, boxes[i]);
    if (score >= bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Überdecken sich zwei Boxen überhaupt (Schnittfläche größer als 0)? */
export function intersects(a: NoParkBox, b: NoParkBox): boolean {
  return Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
}

/** Fahrzeug in diesem Durchlauf gesehen: Box nachziehen (Perspektive und Licht lassen sie leicht wandern). */
function markSeen(s: Standing, box: NoParkBox, now: number): void {
  s.box = box;
  s.lastSeenAt = now;
  s.misses = 0;
  s.missedMs = 0;
  s.emptyChecks = 0;
  s.unseenMs = 0;
}

export interface TrackOptions {
  /** Längster Abstand zweier Prüfungen, der als beobachtet gilt (observedGapLimitMs); Standard OBSERVED_GAP_MAX_MS. */
  gapLimitMs?: number;
  /** Weitere Boxen, die ein Fahrzeug verdecken können (coverBoxes); die Boxen der Fläche zählen immer. */
  covers?: NoParkBox[];
}

/**
 * Kann `s` über die engere Wiedererkennung (SAME_SPOT_IOU) als dasselbe
 * zurückkommen, wenn jetzt `extraMs` beobachtete Zeit hinzukommt? Ein
 * gemeldetes Fahrzeug der laufenden Episode `ep`, höchstens LOST_MEMORY_MS
 * beobachtet seit seiner letzten Sichtung (unseenMs, dieselbe Uhr wie
 * sameVehicle: Zeiten ohne Beobachtung zählen nicht).
 */
function sameSpotCandidate(ep: Episode | null, s: Standing, extraMs: number): boolean {
  return ep !== null && inEpisode(ep, s) && s.unseenMs + extraMs <= LOST_MEMORY_MS;
}

/**
 * Aktuelle Boxen den bekannten Fahrzeugen zuordnen. Ändert `state` an Ort und
 * Stelle: Die Box eines wiedererkannten Fahrzeugs wird nachgezogen, wer
 * MAX_MISSES Prüfungen fehlt, wandert zu den abgerissenen Spuren, eine Box an
 * der Stelle einer abgerissenen übernimmt sie ganz – beides, solange die
 * Stelle nicht zu lange beobachtet leer war (sameVehicle), und für ein
 * gemeldetes Fahrzeug der Episode mit enger Überdeckung (SAME_SPOT_IOU) bis
 * LOST_MEMORY_MS beobachtet seit seiner letzten Sichtung; sonst ist die Box
 * ein neues Fahrzeug. Leer ist eine Prüfung für ein Fahrzeug nur, wenn keine
 * Box seine Box überdeckt (die Boxen der Fläche und `opts.covers`); Zeiten ohne
 * Beobachtung (observedGapMs bis `opts.gapLimitMs`) zählen nicht als leer.
 * War die Fläche zu lange beobachtet leer, wartet die Episode nur noch auf
 * ihre Fahrzeuge und endet, sobald keines mehr zurückkommen kann, weder
 * locker noch eng. Ob etwas zu melden ist, entscheidet planReport.
 */
export function track(state: TrackState, boxes: NoParkBox[], now: number, opts: TrackOptions = {}): TrackResult {
  const result: TrackResult = { added: 0, lost: 0, reacquired: 0, replaced: 0, left: 0, tight: [], episodeEnded: false };
  const dt = observedGapMs(state, now, opts.gapLimitMs);
  const covers = opts.covers ? [...boxes, ...opts.covers] : boxes;
  state.lastCheckAt = now;
  state.blind = false;

  // Nach einem langen Ausfall: wer zu lange nicht gesehen wurde, ist vergessen.
  state.standing = state.standing.filter((s) => now - s.lastSeenAt <= memoryMs(s, false, state.episode));
  state.lost = state.lost.filter((l) => now - l.lastSeenAt <= memoryMs(l, l.gone, state.episode));

  // Dasselbe Fahrzeug nach kurzer Lücke (SAME_VEHICLE_IOU) …
  const sameNow = (s: Standing) => sameVehicle(s, dt);
  // … oder ein gemeldetes der Episode an seiner Stelle (SAME_SPOT_IOU).
  const sameSpot = (s: Standing) => sameSpotCandidate(state.episode, s, dt);
  // Ohne Treffer: eine Prüfung mehr; leer nur, wenn keine Box das Fahrzeug überdeckt.
  const unseen = (s: Standing) => {
    s.misses++;
    s.unseenMs += dt;
    if (covers.some((b) => intersects(b, s.box))) return;
    s.missedMs += dt;
    s.emptyChecks++;
  };
  const seen = (s: Standing, box: NoParkBox, tight: boolean) => {
    markSeen(s, box, now);
    if (tight) result.tight.push(s.id);
  };

  // Bekannt, aber zu lange beobachtet fort: Eine Box an der Stelle ist ein neues Fahrzeug.
  const staleStanding = state.standing.filter((s) => !sameNow(s));
  const unmatched = [...boxes];
  for (const known of state.standing) {
    const loose = sameNow(known);
    const idx = loose ? bestMatch(known.box, unmatched) : sameSpot(known) ? bestMatch(known.box, unmatched, SAME_SPOT_IOU) : -1;
    if (idx >= 0) {
      seen(known, unmatched[idx], !loose);
      unmatched.splice(idx, 1);
    } else unseen(known);
  }

  const back = state.lost.filter((l) => !l.gone && sameNow(l));
  const spots = state.lost.filter((l) => !back.includes(l) && sameSpot(l));
  const forgotten: Standing[] = [
    ...staleStanding.filter((s) => s.lastSeenAt !== now),
    ...state.lost.filter((l) => !back.includes(l)),
  ];
  const drop = (list: Standing[], s: Standing) => {
    const i = list.indexOf(s);
    if (i >= 0) list.splice(i, 1);
  };
  let n = 0;
  for (const box of unmatched) {
    const loose = bestMatch(
      box,
      back.map((l) => l.box),
    );
    const tight = loose < 0 ? bestMatch(box, spots.map((l) => l.box), SAME_SPOT_IOU) : -1;
    if (loose >= 0 || tight >= 0) {
      // Dasselbe Fahrzeug: Standzeit, Meldung, Eintrag in der Historie und
      // Ansagen laufen weiter (dasselbe Objekt, für die Diagnose).
      const l = loose >= 0 ? back.splice(loose, 1)[0] : spots.splice(tight, 1)[0];
      state.lost.splice(state.lost.indexOf(l), 1);
      drop(forgotten, l);
      const s: Partial<LostVehicle> & Standing = l;
      delete s.lostAt;
      delete s.gone;
      seen(s, box, loose < 0);
      state.standing.push(s);
      result.reacquired++;
      continue;
    }
    const at = bestMatch(
      box,
      forgotten.map((f) => f.box),
    );
    if (at >= 0) {
      result.replaced++;
      // Die Stelle ist neu belegt; gemerkt bleibt das alte Fahrzeug nur mit offenem Eintrag.
      const old = forgotten.splice(at, 1)[0];
      drop(spots, old);
      if (!storePending(old)) state.lost = state.lost.filter((l) => l !== old);
    }
    state.standing.push(newStanding(box, now, `${now}-${n++}`));
    result.added++;
  }
  // Abgerissene, die nicht zurück sind: eine Prüfung mehr (weggefahrene für die Diagnose).
  for (const l of state.lost) unseen(l);

  // Wer MAX_MISSES Prüfungen fehlt oder zu lange beobachtet fort ist, reißt ab.
  const kept: Standing[] = [];
  for (const s of state.standing) {
    const same = sameVehicle(s);
    if (s.misses === 0 || (s.misses <= MAX_MISSES && same)) {
      kept.push(s);
      continue;
    }
    const l: LostVehicle = Object.assign(s, { lostAt: now, gone: false });
    state.lost.push(l);
    result.lost++;
  }
  state.standing = kept;
  // Zu lange beobachtet fort: weggefahren. Gemerkt nur noch für einen offenen
  // Eintrag in der Historie, die engere Wiedererkennung und die Diagnose (memoryMs).
  for (const l of state.lost) {
    if (l.gone || sameVehicle(l)) continue;
    l.gone = true;
    result.left++;
  }

  // Fläche: beobachtete Leerzeit, nur ohne jede Box; sie steht still, sobald sie zu lang ist.
  if (boxes.length > 0) {
    state.emptyMs = 0;
    state.emptyChecks = 0;
  } else if (sameVehicleGap(state.emptyMs, state.emptyChecks)) {
    state.emptyMs += dt;
    state.emptyChecks++;
  }
  const ep = state.episode;
  if (ep) {
    // Ein gemeldetes Fahrzeug ist zu sehen: Die Fläche ist belegt, die Episode
    // läuft weiter. Sonst wartet sie nach zu langer beobachteter Leere nur noch
    // auf ihre Fahrzeuge …
    if (state.standing.some((s) => s.lastSeenAt === now && s.reportedAt > 0)) delete ep.vacated;
    else if (!sameVehicleGap(state.emptyMs, state.emptyChecks)) ep.vacated = true;
    // … und endet erst, wenn keines mehr wiedererkannt werden kann, weder
    // locker (etwa verdeckt) noch an seiner Stelle.
    const mayReturn = (s: Standing, gone: boolean) =>
      inEpisode(ep, s) && ((!gone && sameVehicle(s)) || sameSpotCandidate(ep, s, 0));
    if (ep.vacated && !state.standing.some((s) => mayReturn(s, false)) && !state.lost.some((l) => mayReturn(l, l.gone))) {
      state.episode = null;
      result.episodeEnded = true;
    }
  }
  return result;
}

/**
 * Kann ein abgerissenes Fahrzeug jetzt noch nach kurzer Lücke als dasselbe
 * zurückkommen (sameVehicle)? Für den Takt: Solange ja, wird im kurzen
 * Takt geprüft. `limitMs` wie bei track.
 */
export function lostMayReturn(state: TrackState, now: number, limitMs = OBSERVED_GAP_MAX_MS): boolean {
  const dt = observedGapMs(state, now, limitMs);
  return state.lost.some((l) => !l.gone && sameVehicle(l, dt));
}

/* ---------------------------------------------------------------------------
 * Was gemeldet wird
 * ------------------------------------------------------------------------- */

/** Höchstens so viele Ansagen je Fahrzeug. */
export const SPEAKS_PER_VEHICLE = 2;
/** Die zweite Ansage frühestens so lange nach der ersten. */
export const SECOND_SPEAK_AFTER_MS = 10 * 60_000;
/** Zwischen zwei Ansagen an derselben Kamera mindestens so lange. */
export const CAMERA_SPEAK_GAP_MS = 5 * 60_000;
/** Erinnerungen nach der ersten Nachricht einer Episode; danach keine weitere. */
export const REMINDER_AFTER_MS: readonly number[] = [30 * 60_000, 60 * 60_000, 120 * 60_000];
/** Höchstens so viele Versuche je Meldung an die Cloud. */
export const MAX_REPORT_TRIES = 5;
/**
 * Abstand nach dem 1., 2., 3. und 4. gescheiterten Versuch: der zweite im
 * nächsten Durchlauf, dann wachsend. Die fünf Versuche liegen so bei rund 0,
 * 20 s, 2, 10 und 30 Minuten – ein Ausfall von Internet oder Cloud über
 * einige Minuten verbraucht sie nicht.
 */
export const RETRY_AFTER_MS: readonly number[] = [0, 90_000, 8 * 60_000, 20 * 60_000];

/** Wartezeit bis zum nächsten Versuch nach `tries` gescheiterten (1 bis MAX_REPORT_TRIES − 1). */
export function retryDelayMs(tries: number): number {
  if (!(tries >= 1)) return 0;
  return RETRY_AFTER_MS[Math.min(Math.floor(tries), RETRY_AFTER_MS.length) - 1];
}

export interface ReportConfig {
  /** Standzeit bis zur Meldung in Minuten (je Kamera aus der Cloud, sonst HUB_NOPARK_MINUTES). */
  minutes: number;
  /** Ansage eingeschaltet (HUB_NOPARK_SPEAK). */
  speak: boolean;
  /** Stunde für das Ansage-Fenster (Stunde mit Minutenanteil). */
  speakHour: number;
  /** Ansage-Fenster (HUB_NOPARK_SPEAK_FROM/TO, Standard 8–22). */
  speakFrom: number;
  speakTo: number;
  /** Ortszeit-Stunde für das Nachrichten-Fenster. */
  notifyHour: number;
  /** Nachrichten-Fenster (HUB_NOPARK_NOTIFY_FROM/TO, Standard 7–22): außerhalb keine Nachricht. */
  notifyFrom: number;
  notifyTo: number;
}

export type NotifyPlan = { kind: "first" } | { kind: "reminder"; n: number };

export interface ReportPlan {
  /** Fahrzeuge, deren Standzeit in diesem Durchlauf die Schwelle erreicht. */
  due: Standing[];
  /** Ansage abspielen … */
  speak: boolean;
  /** … für diese Fahrzeuge (sie zählt je Fahrzeug). */
  speakFor: Standing[];
  /** Nachricht (Push, Telegram) an die Cloud, null = keine. */
  notify: NotifyPlan | null;
  /** Diese Erinnerung entfällt, weil sie in die Nacht fällt (0 = keine). */
  skipReminder: number;
  /** Eintrag in der Historie mit Bild für diese Fahrzeuge (leer = keiner). */
  store: Standing[];
  /** Fahrzeuge, die gerade in der Fläche stehen und die Schwelle erreicht haben. */
  inZone: number;
  /** Mit diesem Durchlauf beginnt eine Episode. */
  opensEpisode: boolean;
  /** Längste Standzeit unter den Fahrzeugen der Meldung, Sekunden. */
  seconds: number;
}

/**
 * Was dieser Durchlauf meldet (rein, ändert nichts; anwenden mit applyPlan
 * und nach der Antwort der Cloud mit applyDelivery):
 *
 * - Ansage höchstens zweimal je Fahrzeug: beim Erreichen der Schwelle und
 *   einmal 10 Minuten später, frühestens 5 Minuten nach der letzten Ansage
 *   an derselben Kamera, und nur im Ansage-Fenster.
 * - Nachricht, wenn das erste Fahrzeug einer Episode fällig wird; danach
 *   Erinnerungen 30, 60 und 120 Minuten nach der ersten Nachricht, solange
 *   noch ein Fahrzeug steht; danach keine weitere. Ein weiteres Fahrzeug in
 *   derselben Episode bekommt keine eigene Nachricht, die Erinnerungen nennen
 *   die Zahl der Fahrzeuge. Wird es fällig, nachdem die Fläche zu lange
 *   beobachtet leer war (Episode.vacated), beginnt es eine eigene Episode.
 *   Nur ein fälliges Fahrzeug beginnt eine Episode: Ein gemeldetes, das ohne
 *   laufende wieder auftaucht, bekommt keine zweite erste Nachricht.
 * - Außerhalb des Nachrichten-Fensters geht keine Nachricht hinaus. Steht das
 *   Fahrzeug bei Fensterbeginn noch, geht die erste Nachricht dann hinaus;
 *   eine Erinnerung in der Nacht entfällt.
 * - Ein Bild je Fahrzeug: Eintrag in der Historie nur bei seiner ersten
 *   Meldung. Fahrzeuge, die im selben Durchlauf fällig werden, teilen sich
 *   einen Eintrag; jeder Eintrag behält bei allen Versuchen seinen
 *   Schlüssel (reportKeys), ein später fälliges Fahrzeug bekommt einen
 *   eigenen Eintrag und schließt sich keinem offenen an.
 * - Scheitert die Meldung, kommt sie erneut, der zweite Versuch im nächsten
 *   Durchlauf, weitere mit wachsendem Abstand (retryDelayMs), höchstens
 *   MAX_REPORT_TRIES Versuche. Etwas Neues geht sofort hinaus und nimmt eine
 *   offene Nachricht bzw. den ältesten offenen Eintrag mit.
 */
export function planReport(state: TrackState, now: number, cfg: ReportConfig): ReportPlan {
  const thresholdMs = cfg.minutes * 60_000;
  const due = state.standing.filter((s) => s.misses === 0 && s.reportedAt === 0 && now - s.firstSeenAt >= thresholdMs);
  const isReported = (s: Standing) => s.reportedAt > 0 || due.includes(s);
  const seen = state.standing.filter((s) => s.misses === 0 && isReported(s));

  // Ansage
  const speakWindow = cfg.speak && withinSpeakWindow(cfg.speakHour, cfg.speakFrom, cfg.speakTo);
  const cameraQuiet = state.lastSpeakAt === 0 || now - state.lastSpeakAt >= CAMERA_SPEAK_GAP_MS;
  const speakFor =
    speakWindow && cameraQuiet
      ? seen.filter((s) => s.speaks < SPEAKS_PER_VEHICLE && (s.speaks === 0 || now - s.spokeAt >= SECOND_SPEAK_AFTER_MS))
      : [];

  // Nachricht. Eine Episode beginnt nur mit einem fälligen Fahrzeug: ohne
  // laufende oder, wenn sie nur noch auf ihre Fahrzeuge wartet (vacated), eine
  // eigene. Ein gemeldetes Fahrzeug, das ohne laufende Episode wieder
  // auftaucht, bekommt keine erste Nachricht, höchstens die nächste fällige
  // Erinnerung einer laufenden.
  const opensEpisode = (!state.episode || state.episode.vacated === true) && due.length > 0;
  const episode: Episode | null = opensEpisode ? { startedAt: now, firstAt: 0, reminders: 0, tries: 0 } : state.episode;
  const notifyWindow = withinSpeakWindow(cfg.notifyHour, cfg.notifyFrom, cfg.notifyTo);
  let notify: NotifyPlan | null = null;
  let skipReminder = 0;
  if (episode && episode.firstAt === 0) {
    // Eine gescheiterte erste Nachricht wird wiederholt, auch wenn das
    // Fahrzeug gerade nicht zu sehen ist; sonst braucht sie ein stehendes.
    if (notifyWindow && (seen.length > 0 || episode.tries > 0)) notify = { kind: "first" };
  } else if (episode) {
    const n = REMINDER_AFTER_MS.filter((ms) => now - episode.firstAt >= ms).length;
    if (n > episode.reminders && (seen.length > 0 || episode.tries > 0)) {
      if (notifyWindow) notify = { kind: "reminder", n };
      else skipReminder = n;
    }
  }

  // Historie: erste Meldung eines Fahrzeugs, auch abgerissene mit offenem Versuch.
  const open = [...state.standing, ...state.lost].filter(
    (s) => isReported(s) && !s.stored && s.storeTries < MAX_REPORT_TRIES,
  );
  // Neu fällig (noch ohne Schlüssel): ein eigener Eintrag, sofort.
  const freshStore = open.filter((s) => s.storeKey === null);
  const freshNotify = notify !== null && (episode?.tries ?? 0) === 0;
  // Nach einem gescheiterten Versuch: Wiederholungen erst ab retryAt.
  const retryDue = now >= state.retryAt;
  const store = freshStore.length > 0 ? freshStore : freshNotify || retryDue ? oldestOpenEntry(open) : [];
  if (freshStore.length === 0 && !freshNotify && !retryDue) notify = null;

  const about = store.length > 0 ? store : seen;
  const seconds = Math.round(about.reduce((max, s) => Math.max(max, now - s.firstSeenAt), 0) / 1000);
  return {
    due,
    speak: speakFor.length > 0,
    speakFor,
    notify,
    skipReminder,
    store,
    inZone: seen.length,
    opensEpisode,
    seconds,
  };
}

/**
 * Ältester offener Eintrag in der Historie (schon versucht, mit Schlüssel):
 * alle Fahrzeuge mit seinem Schlüssel. Leer, wenn keiner offen ist.
 */
function oldestOpenEntry(open: Standing[]): Standing[] {
  const tried = open.filter((s) => s.storeKey !== null);
  if (tried.length === 0) return [];
  const first = tried.reduce((a, b) => (b.reportedAt < a.reportedAt || (b.reportedAt === a.reportedAt && b.firstSeenAt < a.firstSeenAt) ? b : a));
  return tried.filter((s) => s.storeKey === first.storeKey);
}

/**
 * Schlüssel eines Eintrags in der Historie: der schon festgelegte, sonst die
 * Kennung des zuerst gesehenen Fahrzeugs darin. Eindeutig, weil jedes
 * Fahrzeug nur zu einem Eintrag gehört; null ohne Fahrzeug.
 */
export function storeKeyOf(store: readonly Standing[]): string | null {
  if (store.length === 0) return null;
  const fixed = store.find((s) => s.storeKey !== null);
  if (fixed) return fixed.storeKey;
  const first = store.reduce((a, b) => (b.firstSeenAt < a.firstSeenAt || (b.firstSeenAt === a.firstSeenAt && b.id < a.id) ? b : a));
  return first.id;
}

/** Plan vor dem Senden anwenden: Meldezeitpunkt, Ansagen, Episode, Schlüssel des Eintrags. */
export function applyPlan(state: TrackState, plan: ReportPlan, now: number): void {
  for (const s of plan.due) s.reportedAt = now;
  const key = storeKeyOf(plan.store);
  for (const s of plan.store) s.storeKey ??= key;
  if (plan.speak) {
    for (const s of plan.speakFor) {
      s.speaks++;
      s.spokeAt = now;
    }
    state.lastSpeakAt = now;
  }
  if (plan.opensEpisode && (!state.episode || state.episode.vacated)) {
    state.episode = { startedAt: now, firstAt: 0, reminders: 0, tries: 0 };
  }
  if (plan.skipReminder > 0 && state.episode) {
    state.episode.reminders = Math.max(state.episode.reminders, plan.skipReminder);
    state.episode.tries = 0;
  }
}

/**
 * Schlüssel der Meldung, gleich bei jedem Versuch und nach einem Neustart:
 * Eintrag in der Historie nach der Kennung des Fahrzeugs (storeKeyOf, beim
 * ersten Versuch festgelegt), Nachricht nach Beginn der Episode und Art
 * (f = erste, rN = N. Erinnerung). Kam die Antwort auf einen Versuch nicht
 * an, legt die Cloud damit keine zweite Sichtung an und schickt keine zweite
 * Nachricht.
 */
export function reportKeys(state: TrackState, plan: ReportPlan): { storeKey: string | null; notifyKey: string | null } {
  const storeKey = storeKeyOf(plan.store);
  const ep = state.episode;
  const notifyKey =
    plan.notify && ep ? `${ep.startedAt}-${plan.notify.kind === "first" ? "f" : `r${plan.notify.n}`}` : null;
  return { storeKey, notifyKey };
}

/** Muss dieser Plan zur Cloud? Nur mit Nachricht oder Eintrag in der Historie. */
export function needsCloud(plan: ReportPlan): boolean {
  return plan.notify !== null || plan.store.length > 0;
}

/**
 * Antwort der Cloud anwenden. `ok`: die Cloud hat mit Erfolg geantwortet.
 * Sonst zählt der Versuch, und der nächste kommt frühestens nach
 * retryDelayMs der am häufigsten gescheiterten offenen Meldung
 * (state.retryAt); nach MAX_REPORT_TRIES gilt eine Meldung als erledigt,
 * damit sie nicht ewig wiederholt wird. Nach einer Antwort kommt ein noch
 * offener Eintrag im nächsten Durchlauf. Liefert, was aufgegeben wurde, und
 * die Zahl der Versuche der offenen Meldung dieses Plans (0 = nichts offen).
 */
export function applyDelivery(
  state: TrackState,
  plan: ReportPlan,
  ok: boolean,
  now: number,
): { gaveUp: number; tries: number } {
  let gaveUp = 0;
  let tries = 0;
  for (const s of plan.store) {
    if (ok) s.stored = true;
    else if (++s.storeTries >= MAX_REPORT_TRIES) {
      s.stored = true;
      gaveUp++;
    } else tries = Math.max(tries, s.storeTries);
  }
  const ep = state.episode;
  if (plan.notify && ep) {
    const done = ok || ++ep.tries >= MAX_REPORT_TRIES;
    if (!ok && done) gaveUp++;
    if (done) {
      ep.tries = 0;
      if (plan.notify.kind === "first") ep.firstAt = now;
      else ep.reminders = Math.max(ep.reminders, plan.notify.n);
    } else tries = Math.max(tries, ep.tries);
  }
  // Auch Meldungen, die dieser Plan nicht trug, bestimmen den Abstand mit.
  const pending = Math.max(
    tries,
    state.episode?.tries ?? 0,
    ...[...state.standing, ...state.lost].filter((s) => storePending(s)).map((s) => s.storeTries),
  );
  state.retryAt = !ok && pending > 0 ? now + retryDelayMs(pending) : 0;
  return { gaveUp, tries };
}

/**
 * Schlüssel des gespeicherten Eintrags, dessen Ausschnitt die Cloud mit der
 * ersten Nachricht an Telegram schickt, wenn dieser Plan keinen neuen Eintrag
 * trägt (etwa nachts gespeichert, Nachricht um 7 Uhr): ein gemeldetes
 * Fahrzeug, zuerst eines, das gerade zu sehen ist. null, wenn der Plan keine
 * erste Nachricht trägt, selbst einen Eintrag trägt (dann reicht der Hub den
 * Ausschnitt nach) oder kein Eintrag gespeichert ist.
 */
export function evidenceKeyFor(state: TrackState, plan: ReportPlan): string | null {
  if (plan.notify?.kind !== "first" || plan.store.length > 0) return null;
  const stored = (s: Standing) => s.reportedAt > 0 && s.stored && s.storeKey !== null;
  const pick =
    state.standing.find((s) => s.misses === 0 && stored(s)) ??
    state.standing.find(stored) ??
    state.lost.find(stored);
  return pick?.storeKey ?? null;
}

/**
 * Bilder des ersten Versuchs einer Meldung, für ihre Wiederholungen (nur im
 * Speicher): Ist das Fahrzeug bis dahin fort, zeigen Historie und Telegram
 * trotzdem das Bild, in dem es stand. Schlüssel: Eintrag in der Historie,
 * sonst die Nachricht (reportKeys).
 */
export class AttemptImages<T> {
  private readonly entries = new Map<string, { value: T; at: number }>();

  constructor(private readonly maxAgeMs = 2 * 60 * 60_000) {}

  static key(cameraId: number, keys: { storeKey: string | null; notifyKey: string | null }): string | null {
    if (keys.storeKey) return `${cameraId}:s:${keys.storeKey}`;
    if (keys.notifyKey) return `${cameraId}:n:${keys.notifyKey}`;
    return null;
  }

  /**
   * Bilder zu `key`: die des ersten Versuchs, solange sie höchstens maxAgeMs
   * alt sind, sonst `make()` (dann gemerkt).
   */
  get(key: string | null, now: number, make: () => T): { value: T; repeated: boolean } {
    const known = key ? this.entries.get(key) : undefined;
    if (known && now - known.at <= this.maxAgeMs) return { value: known.value, repeated: true };
    const value = make();
    if (key) this.entries.set(key, { value, at: now });
    return { value, repeated: false };
  }

  /** Erledigte Meldung vergessen; dazu alles älter als maxAgeMs. */
  done(key: string | null, now: number): void {
    if (key) this.entries.delete(key);
    for (const [k, e] of this.entries) if (now - e.at > this.maxAgeMs) this.entries.delete(k);
  }

  get size(): number {
    return this.entries.size;
  }
}

/* ---------------------------------------------------------------------------
 * Gesicherter Zustand (hub/.cache/noparking.json)
 * ------------------------------------------------------------------------- */

/**
 * Bis zu diesem Alter lädt ein Neustart den gesicherten Zustand ganz, auch
 * noch nicht gemeldete Fahrzeuge (Standzeit läuft weiter). Gemeldete
 * Fahrzeuge und ihre Episode bleiben länger (REPORTED_MEMORY_MS nach der
 * letzten Sichtung): Die Zeit, in der der Hub aus war, zählt nicht als leer.
 */
export const SAVED_STATE_MAX_AGE_MS = LOST_MEMORY_MS;

/**
 * Ein nicht leerer Zustand wird spätestens nach dieser Zeit neu gesichert,
 * auch unverändert (etwa während Kamera oder Tracker ausfallen): Sonst
 * verwürfe ein Neustart die Datei als zu alt (SAVED_STATE_MAX_AGE_MS).
 */
export const STATE_REFRESH_MS = 5 * 60_000;

/** Steht in einem der Zustände etwas, das ein Neustart wissen muss? */
export function hasTrackState(states: Iterable<TrackState>): boolean {
  for (const s of states) {
    if (s.standing.length > 0 || s.lost.length > 0 || s.episode) return true;
  }
  return false;
}

/**
 * Jetzt sichern? Nicht vor dem Laden der Datei (sonst überschriebe ein
 * frühes Beenden sie mit einem leeren Stand); sonst bei jeder Änderung, und
 * ein nicht leerer Zustand auch unverändert nach STATE_REFRESH_MS oder beim
 * Beenden (`force`), damit der Zeitstempel frisch ist.
 */
export function saveDue(o: {
  loaded: boolean;
  /** Stand ohne Zeitstempel (serializeTrackStates mit 0) jetzt und beim letzten Sichern. */
  key: string;
  savedKey: string;
  savedAt: number;
  now: number;
  hasState: boolean;
  force: boolean;
}): boolean {
  if (!o.loaded) return false;
  if (o.key !== o.savedKey) return true;
  if (!o.hasState) return false;
  return o.force || o.now - o.savedAt >= STATE_REFRESH_MS;
}

/**
 * Zustand aller Kameras als Text für die Datei. Ohne lastCheckAt und blind:
 * Nach einem Neustart zählt die Zeit seit der letzten Prüfung ohnehin nicht
 * als leer (parseTrackStates); so ändert eine leere Fläche die Datei nicht.
 */
export function serializeTrackStates(states: ReadonlyMap<number, TrackState>, now: number): string {
  const cameras: Record<string, Omit<TrackState, "lastCheckAt" | "blind">> = {};
  for (const [id, s] of states) {
    cameras[String(id)] = {
      standing: s.standing,
      lost: s.lost,
      episode: s.episode,
      lastSpeakAt: s.lastSpeakAt,
      retryAt: s.retryAt,
      emptyMs: s.emptyMs,
      emptyChecks: s.emptyChecks,
    };
  }
  return JSON.stringify({ v: 1, savedAt: now, cameras });
}

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function readBox(v: unknown): NoParkBox | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  const box = { cls: num(b.cls, -1), conf: num(b.conf), x: num(b.x), y: num(b.y), w: num(b.w), h: num(b.h) };
  return box.w > 0 && box.h > 0 ? box : null;
}

/** Kennung und Schlüssel wie vom Hub erzeugt (die Cloud nimmt Ziffern, Buchstaben und . : _ - an). */
const ID_RE = /^[0-9A-Za-z.:_-]{1,40}$/;

/** Ein Fahrzeug aus der Datei; ohne gültige Kennung, Box oder Zeiten verworfen. */
function readStanding(v: unknown): Standing | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const box = readBox(r.box);
  const firstSeenAt = num(r.firstSeenAt);
  const lastSeenAt = num(r.lastSeenAt);
  if (typeof r.id !== "string" || !ID_RE.test(r.id) || !box || firstSeenAt <= 0 || lastSeenAt < firstSeenAt) return null;
  const misses = Math.max(0, Math.floor(num(r.misses)));
  const missedMs = Math.max(0, num(r.missedMs));
  return {
    id: r.id,
    box,
    firstSeenAt,
    lastSeenAt,
    misses,
    missedMs,
    emptyChecks: Math.max(0, Math.floor(num(r.emptyChecks, misses))),
    unseenMs: Math.max(missedMs, num(r.unseenMs, missedMs)),
    reportedAt: Math.max(0, num(r.reportedAt)),
    stored: r.stored === true,
    storeTries: Math.max(0, Math.floor(num(r.storeTries))),
    storeKey: typeof r.storeKey === "string" && ID_RE.test(r.storeKey) ? r.storeKey : null,
    speaks: Math.max(0, Math.floor(num(r.speaks))),
    spokeAt: Math.max(0, num(r.spokeAt)),
  };
}

function readEpisode(v: unknown): Episode | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const startedAt = num(r.startedAt);
  if (startedAt <= 0) return null;
  return {
    startedAt,
    firstAt: Math.max(0, num(r.firstAt)),
    reminders: Math.min(REMINDER_AFTER_MS.length, Math.max(0, Math.floor(num(r.reminders)))),
    tries: Math.max(0, Math.floor(num(r.tries))),
    ...(r.vacated === true ? { vacated: true as const } : {}),
  };
}

/**
 * Gesicherten Zustand lesen. Aus der Zukunft, älter als REPORTED_MEMORY_MS
 * oder nicht lesbar: leer. Fahrzeuge bleiben, solange sie auch im Speicher
 * gemerkt blieben (memoryMs: gemeldete REPORTED_MEMORY_MS, übrige
 * LOST_MEMORY_MS nach der letzten Sichtung); die Episode, solange die Datei
 * höchstens SAVED_STATE_MAX_AGE_MS alt ist oder ein gemeldetes Fahrzeug
 * bleibt. Die Zeit bis zur ersten Prüfung zählt nicht als leer (blind).
 */
export function parseTrackStates(raw: string, now: number): Map<number, TrackState> {
  const out = new Map<number, TrackState>();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!data || typeof data !== "object") return out;
  const d = data as { v?: unknown; savedAt?: unknown; cameras?: unknown };
  const savedAt = num(d.savedAt);
  if (d.v !== 1 || savedAt <= 0 || now - savedAt > REPORTED_MEMORY_MS || savedAt - now > 60_000) return out;
  if (!d.cameras || typeof d.cameras !== "object") return out;
  const fresh = now - savedAt <= SAVED_STATE_MAX_AGE_MS;
  for (const [key, value] of Object.entries(d.cameras as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isInteger(id) || !value || typeof value !== "object") continue;
    const c = value as Record<string, unknown>;
    const rawStanding = Array.isArray(c.standing) ? c.standing : [];
    const rawLost = Array.isArray(c.lost) ? c.lost : [];
    const savedEpisode = readEpisode(c.episode);
    const standing = rawStanding
      .map((s) => readStanding(s))
      .filter((s): s is Standing => s !== null && now - s.lastSeenAt <= memoryMs(s, false, savedEpisode));
    const lost = rawLost
      .map((l) => {
        const s = readStanding(l);
        const r = l as Record<string, unknown>;
        const lostAt = num(r.lostAt);
        if (!s || lostAt < s.lastSeenAt) return null;
        const gone = r.gone === true || !sameVehicle(s);
        return now - s.lastSeenAt <= memoryMs(s, gone, savedEpisode) ? { ...s, lostAt, gone } : null;
      })
      .filter((l): l is LostVehicle => l !== null);
    const reported = [...standing, ...lost].some((s) => s.reportedAt > 0);
    const episode = fresh || reported ? savedEpisode : null;
    if (!fresh && standing.length === 0 && lost.length === 0 && !episode) continue;
    out.set(id, {
      standing,
      lost,
      episode,
      lastSpeakAt: Math.max(0, num(c.lastSpeakAt)),
      retryAt: Math.max(0, num(c.retryAt)),
      lastCheckAt: 0,
      blind: true,
      emptyMs: Math.max(0, num(c.emptyMs)),
      emptyChecks: Math.max(0, Math.floor(num(c.emptyChecks))),
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Zeitfenster
 * ------------------------------------------------------------------------- */

/**
 * Liegt `hour` (Stunde mit Bruchteil, z. B. 21,5 für 21:30) im Fenster
 * `from`–`to`? Gleiche Grenzen heißen „immer“. Über Mitternacht hinweg
 * (z. B. 22–6) ist das Fenster umgedreht.
 */
export function withinSpeakWindow(hour: number, from: number, to: number): boolean {
  if (from === to) return true;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/* ---------------------------------------------------------------------------
 * Fristen des Durchlaufs
 * ------------------------------------------------------------------------- */

/** Auf die Ansage wird höchstens so lange gewartet; sie läuft danach allein zu Ende. */
export const SPEAK_WAIT_MS = 20_000;
/**
 * Ein Durchlauf, der länger dauert, wird freigegeben (gezählt als
 * noparking.stuck): Der nächste darf beginnen, der alte ändert den Zustand
 * nicht mehr.
 */
export const STUCK_RUN_MS = 90_000;

/**
 * Höchstens `ms` auf `work` warten. true = in der Zeit fertig (gelungen oder
 * gescheitert), false = Frist abgelaufen. Wirft nie; `work` läuft weiter.
 */
export function waitAtMost(work: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    work.then(done, done);
  });
}

/**
 * Aufgaben nacheinander ausführen: Die nächste beginnt erst, wenn die vorige
 * endet, auch nach einem Fehler (Sichern des Zustands aus Durchlauf und
 * Beenden in dieselbe Datei).
 */
export function serialQueue(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>) => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * Beim Beenden: höchstens `waitMs` auf den laufenden Durchlauf warten, dann
 * sichern. true = der Durchlauf war rechtzeitig fertig (oder es lief keiner).
 */
export async function finishThenSave(
  pass: Promise<unknown> | null,
  waitMs: number,
  save: () => Promise<void>,
): Promise<boolean> {
  const finished = pass ? await waitAtMost(pass, waitMs) : true;
  await save();
  return finished;
}

/** Ein Durchlauf; `abandoned`: nach der Frist freigegeben, ändert den Zustand nicht mehr. */
export interface NoParkRun {
  startedAt: number;
  abandoned: boolean;
}

/** Platz für genau einen Durchlauf zur Zeit. */
export interface RunSlot {
  current: NoParkRun | null;
}

/**
 * Einen Durchlauf ausführen, wenn der Platz frei ist. Läuft schon einer:
 * "skipped". Endet `work` nicht in `stuckMs`, wird der Durchlauf als
 * aufgegeben markiert, der Platz freigegeben, `onStuck` gerufen und "stuck"
 * geliefert; `work` muss nach jedem Warten auf `run.abandoned` sehen. Ein
 * Fehler in `work` gibt den Platz ebenso frei ("done"). Wirft nie.
 */
export async function runExclusive(
  slot: RunSlot,
  now: number,
  stuckMs: number,
  work: (run: NoParkRun) => Promise<void>,
  onStuck: (run: NoParkRun) => void,
  onError: (err: unknown) => void,
): Promise<"skipped" | "done" | "stuck"> {
  if (slot.current) return "skipped";
  const run: NoParkRun = { startedAt: now, abandoned: false };
  slot.current = run;
  const job = (async () => work(run))()
    .catch(onError)
    .finally(() => {
      if (slot.current === run) slot.current = null;
    });
  if (await waitAtMost(job, stuckMs)) return "done";
  run.abandoned = true;
  if (slot.current === run) slot.current = null;
  onStuck(run);
  return "stuck";
}

/* ---------------------------------------------------------------------------
 * Takt
 * ------------------------------------------------------------------------- */

/** Abstand bei leerer Fläche. */
export const IDLE_CHECK_MS = 60_000;
/** Abstand bei leerer Fläche in der Nacht (NIGHT_FROM bis NIGHT_TO Uhr Ortszeit). */
export const NIGHT_CHECK_MS = 120_000;
export const NIGHT_FROM = 22;
export const NIGHT_TO = 6;
/**
 * Meldet die Kamera selbst ein Fahrzeug (VEHICLE), gilt für diese Zeit der
 * kurze Takt: Ein einparkendes Fahrzeug wird so früh gesehen wie im festen
 * Takt, auch wenn der letzte Durchlauf die Fläche leer fand.
 */
export const VEHICLE_EVENT_WINDOW_MS = 3 * 60_000;
/** Mindestabstand zwischen dem Ende eines Durchlaufs und dem nächsten. */
export const MIN_CHECK_GAP_MS = 1_000;

export interface CheckDelayConfig {
  /** Kurzer Takt (HUB_NOPARK_INTERVAL, Standard 20 s). */
  activeMs: number;
  idleMs: number;
  nightMs: number;
  /** Ortszeit-Stunde (mit Minutenanteil). */
  hour: number;
  /** HUB_NOPARK_FIXED_INTERVAL=1: immer der kurze Takt. */
  fixed: boolean;
}

/** Was der Takt außer der Spur noch wissen muss. */
export interface CheckSignals {
  /** Der letzte Durchlauf an dieser Kamera blieb ohne Ergebnis (Fehler, Tracker weg, Kamera nicht in Grundstellung). */
  lastRunFailed: boolean;
  /** Letzte Fahrzeug-Meldung der Kamera selbst (VEHICLE), 0 = keine. */
  vehicleEventAt: number;
}

export type CheckReason =
  | "fest"
  | "fahrzeug"
  | "aussetzer"
  | "abgerissen"
  | "meldung"
  | "fehler"
  | "kamera"
  | "leer"
  | "nacht";

export const CHECK_REASON_TEXT: Record<CheckReason, string> = {
  fest: "fester Takt",
  fahrzeug: "Fahrzeug in der Fläche",
  aussetzer: "Spur mit Aussetzer",
  abgerissen: "Fahrzeug gerade weg",
  meldung: "Meldung an die Cloud offen",
  fehler: "letzter Durchlauf ohne Ergebnis",
  kamera: "Kamera meldet Fahrzeug",
  leer: "Fläche leer",
  nacht: "Fläche leer, Nacht",
};

/**
 * Wartezeit bis zum nächsten Durchlauf für eine Kamera, mit Grund: bei leerer
 * Fläche IDLE_CHECK_MS (nachts NIGHT_CHECK_MS), sobald etwas zu beobachten
 * ist, der kurze Takt. Die Standzeit zählt unabhängig davon ab der ersten
 * Sichtung.
 */
export function checkDelay(
  state: TrackState & CheckSignals,
  now: number,
  cfg: CheckDelayConfig,
): { ms: number; reason: CheckReason } {
  const active = (reason: CheckReason) => ({ ms: cfg.activeMs, reason });
  if (cfg.fixed) return active("fest");
  if (state.standing.some((s) => s.misses > 0)) return active("aussetzer");
  if (state.standing.length > 0) return active("fahrzeug");
  // Ein abgerissenes Fahrzeug kann noch als dasselbe zurückkommen (sameVehicleGap).
  if (lostMayReturn(state, now, observedGapLimitMs(Math.max(cfg.activeMs, cfg.idleMs, cfg.nightMs)))) return active("abgerissen");
  const pending =
    (state.episode?.tries ?? 0) > 0 ||
    [...state.standing, ...state.lost].some((s) => s.reportedAt > 0 && !s.stored && s.storeTries < MAX_REPORT_TRIES);
  if (pending) return active("meldung");
  if (state.lastRunFailed) return active("fehler");
  if (state.vehicleEventAt > 0 && now - state.vehicleEventAt < VEHICLE_EVENT_WINDOW_MS) return active("kamera");
  const night = withinSpeakWindow(cfg.hour, NIGHT_FROM, NIGHT_TO);
  return { ms: Math.max(cfg.activeMs, night ? cfg.nightMs : cfg.idleMs), reason: night ? "nacht" : "leer" };
}

export function nextCheckDelayMs(state: TrackState & CheckSignals, now: number, cfg: CheckDelayConfig): number {
  return checkDelay(state, now, cfg).ms;
}

/** Mehrere Kameras: die kürzeste Wartezeit; ohne Kamera die einer leeren Fläche. */
export function soonestCheck(
  states: readonly (TrackState & CheckSignals)[],
  now: number,
  cfg: CheckDelayConfig,
): { ms: number; reason: CheckReason } {
  const empty = { ...emptyTrackState(), lastRunFailed: false, vehicleEventAt: 0 };
  let best = checkDelay(empty, now, cfg);
  for (const s of states) {
    const d = checkDelay(s, now, cfg);
    if (d.ms < best.ms) best = d;
  }
  return best;
}

/* ---------------------------------------------------------------------------
 * Ausschnitt in voller Auflösung (erste Meldung)
 * ------------------------------------------------------------------------- */

/** Ausschnitt: Box mal EVIDENCE_FACTOR … */
export const EVIDENCE_FACTOR = 2;
/** … und mindestens so breit (Pixel des Originalbilds). */
export const EVIDENCE_MIN_WIDTH_PX = 800;

/** Normiertes Rechteck (0..1) für cropJpeg. */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Kleinste Box, die alle Boxen umfasst (null = keine). */
export function unionBox(boxes: readonly NormRect[]): NormRect | null {
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Ausschnitt um eine Box (normiert) für ein Bild von `width` × `height`
 * Pixeln: um die Mitte der Box `factor`-fach vergrößert, mindestens
 * EVIDENCE_MIN_WIDTH_PX breit (die Höhe wächst im selben Verhältnis), am
 * Bildrand nach innen verschoben, höchstens das ganze Bild. Ergebnis
 * normiert; null bei unbrauchbaren Angaben.
 */
export function evidenceRect(box: NormRect, factor: number, width: number, height: number): NormRect | null {
  if (![box.x, box.y, box.w, box.h, factor, width, height].every(Number.isFinite)) return null;
  if (box.w <= 0 || box.h <= 0 || width <= 0 || height <= 0 || factor <= 0) return null;
  const cx = (box.x + box.w / 2) * width;
  const cy = (box.y + box.h / 2) * height;
  let w = box.w * width * factor;
  let h = box.h * height * factor;
  if (w < EVIDENCE_MIN_WIDTH_PX) {
    h *= EVIDENCE_MIN_WIDTH_PX / w;
    w = EVIDENCE_MIN_WIDTH_PX;
  }
  w = Math.min(w, width);
  h = Math.min(h, height);
  const x = Math.min(Math.max(0, cx - w / 2), width - w);
  const y = Math.min(Math.max(0, cy - h / 2), height - h);
  return { x: x / width, y: y / height, w: w / width, h: h / height };
}
