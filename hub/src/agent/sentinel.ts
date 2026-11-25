/**
 * Waechter mit Augen: Kamera-Ereignisse ausserhalb des Betriebs selbst
 * ansehen (Bildmodell), bei Auffaelligem die Kamera mitfuehren und Aaron mit
 * Bildern benachrichtigen.
 *
 * Ohne Rueckfrage (harmlos, stellt sich selbst zurueck):
 *  - Schwenk-Kameras folgen Personen schon ab dem ersten Signal
 *    (camera-motion.ts), nicht erst nach dem Alarm.
 *  - Bildserie: drei Standbilder im Abstand von 4 s.
 * Personen: optische Nahaufnahme (personCloseUp, gemeinsam mit der
 * Gesichtserkennung), sonst digitaler Ausschnitt; bewerten und
 * mit eingestempelten Mitarbeitern (emp-control) und der bestehenden
 * Gesichtserkennung abgleichen; vermutlich Mitarbeiter → kein Alarm
 * (Regeln in sentinel-rules.ts, decidePerson).
 * Personen im Nachtfenster: Ein „unauffaellig“ des Bildmodells gilt erst,
 * wenn auch der Tracker auf dem ersten Bild und auf zwei weiteren
 * Standbildern niemanden sieht (needsSecondLook, secondLookResult). Zu jeder
 * Stunde gilt es bei einer Person nur, wenn die Gesichtserkennung an der
 * Kamera kein Gesicht gemeldet hat (afterCalm). Sieht der Tracker niemanden,
 * gibt es keinen Alarm nur, wenn auch die Gesichtserkennung an der Kamera
 * kein Gesicht gemeldet hat (trackerVeto).
 * Mit Knopf in Telegram (Aaron entscheidet): Scheinwerfer, Sirene, neues Bild.
 * Nie automatisch: Tor oeffnen, Sirene, Licht, Netzwerk.
 *
 * Ein Alarm klingelt einmal: Die erste Nachricht (Nahaufnahme mit Text und
 * Knoepfen) kommt mit Ton, Uebersicht und Bildserie still. Im Nachtfenster,
 * bei einer gesperrten Person oder einer harten Handlung ist er als DRINGEND
 * markiert (alarm-rules.ts, alarmLevel).
 *
 * Je Kamera eine Einstellung „Wächter“ aus der Cloud (sentinel-mode-rules.ts):
 * wie der Raum (Standard), nur nachts (allein das Nachtfenster entscheidet)
 * oder aus. Jede Kamera, die vom Standard abweicht, steht beim Start und bei
 * jeder Aenderung einmal im Log. HUB_AGENT_SENTINEL=always bewertet nur die
 * Kameras „wie der Raum“ rund um die Uhr: „nur nachts“ bleibt beim
 * Nachtfenster, „aus“ gilt immer (modeAlways).
 *
 * Je Kamera gilt nach einer Bewertung eine Sperrzeit, die sich nach dem
 * Ergebnis richtet (cooldownFor). Hoechstens zwei Bewertungen laufen
 * gleichzeitig; ein Ausloeser ohne freien Platz wird bis zu 30 s lang im
 * naechsten Takt erneut versucht. Je Stunde mit Ausloesern steht eine Bilanz
 * im Log. Der Takt ist reine Logik (sentinel-rules.ts, planTick).
 *
 * Bildmodell (vision-rules.ts): Ist es nicht bereit, stellt der Takt es
 * hoechstens alle 5 Minuten neu bereit; im Log steht eine Zeile je Wechsel.
 * Scheitert der Aufruf zum Uebersichtsbild, entscheidet eine feste Regel
 * (onVisionError): Bei einer Person im Bild oder im Nachtfenster geht der
 * Alarm mit dem Vermerk „ungeprüft“ hinaus, sonst bleibt es beim Befund des
 * Zustands-Waechters.
 *
 * Zu jeder Bewertung steht eine Zeile im Log, was die Aufrufe des Bildmodells
 * gekostet haben und wofuer die Antwort-Token verbraucht wurden (Zeitangaben
 * von Ollama, Laenge von Antwort- und Denktext, vision-timing-rules.ts).
 *
 * Ein Meldeweg in der Nacht (sentinel-cover-rules.ts): Jeder Takt haelt fest,
 * welche Kameras der Waechter gerade nachweislich bewacht; das Lebenszeichen
 * meldet die Liste der Cloud (sentinelCoverage). An diesen Kameras meldet
 * die Cloud-Ueberwachung eine unbekannte Person nur dann nicht selbst, wenn
 * der Upload der Sichtung den Beleg `sentinel=1` traegt: Der Waechter
 * bewertet genau diese Person gerade oder hat sie gemeldet (vouchNow,
 * sentinel-vouch.ts). In der Liste
 * steht eine Kamera nur, solange der Waechter bewertet, was sie gerade
 * sieht, oder einen neuen Ausloeser dort sofort bewerten wuerde (cameraDuty,
 * aus Warteschlange und offenen Personen-Ereignissen). Faellt eine Kamera
 * aus der Liste, geht das Lebenszeichen sofort hinaus (onCoverageShrink);
 * jede Aenderung der Liste steht im Log.
 *
 * Bewachungs-Zustand (sentinel-guard-rules.ts): Beim Start steht im Log,
 * welche Kameras bewacht sind und warum, danach jeder Wechsel je Kamera mit
 * Grund. Die Tagesvorschau am Morgen nennt, was heute bewacht wird
 * (sentinelTodayLine).
 */
import { log } from "../config.js";
import { currentEventSeq, hubEventsSince, recordHubEvent, type HubEvent } from "../state.js";
import { captureSnapshot, cameraFollowing, findCameraByRef, getCameraCaps, listCameraConfigs, personCloseUp } from "../cameras.js";
import { captureDoorbirdSnapshot, isDoorbird } from "../doorbird.js";
import { roomsPayload, roomsSyncedAt } from "../rooms.js";
import { improve, improveCount } from "../improve-log.js";
import { LLM, VISION, VISION_NUM_CTX, VisionCutOffError, askVisionTimed, ensureVisionModel } from "./ollama.js";
import { alarmDeliveryTrouble, sendAlarm, sendAlarmImage } from "./dispatch.js";
import { beginWork, endWork, recordActivity } from "./activity.js";
import type { TgButton } from "./telegram.js";
import { berlinHour } from "./quiet.js";
import { alarmButtonRow, alarmHead, alarmLevel } from "./alarm-rules.js";
import { modeAlways, readSentinelMode, sentinelClosed, sentinelModeLines, type SentinelMode } from "./sentinel-mode-rules.js";
import {
  INSPECT_COVER_MAX_MS,
  cameraDuty,
  cloudQuietOn,
  coverageLine,
  coverageReport,
  coverageShrank,
  coveredCameras,
  inspectionsInLastHour,
  vouchFor,
  type CameraDuty,
  type Coverage,
  type Vouch,
} from "./sentinel-cover-rules.js";
import { setSentinelVouch } from "../sentinel-vouch.js";
import { sentinelNightWindow, setCameraRoomClosed } from "../camera-room.js";
import { ROOMS_MAX_AGE_MS, roomsClosed, type RoomsClosed } from "./sentinel-rooms-rules.js";
import { berlinClock, guardChangeLines, guardState, guardTodayLine, type GuardCamera } from "./sentinel-guard-rules.js";
import {
  FACE_WAIT_MS,
  RETRY_MAX_AGE_MS,
  SECOND_LOOK_DELAYS_MS,
  VEHICLE_BACKLOG_MAX,
  afterCalm,
  appendBacklog,
  decidePerson,
  dueTallies,
  emptyLookOverruled,
  finishInspection,
  isTriggerEvent,
  lockMs,
  needsSecondLook,
  newQueue,
  parsePersonLook,
  parseVerdict,
  planTick,
  secondLookResult,
  tallyLine,
  trackerVeto,
  type AlarmBasis,
  type Handlung,
  type InspectOutcome,
  type PersonLook,
  type SkipReason,
  type StartedInspection,
  type Verdict,
} from "./sentinel-rules.js";
import {
  activeCleared,
  clearedTitle,
  faceAt,
  faceSeenAt,
  knownPrompt,
  notePersonEvents,
  offerPersonOk,
  rememberReported,
  rememberSeen,
  staffClockedIn,
} from "./people.js";
import { knownUsable } from "./people-rules.js";
import { cameraSawKnownPlate, noteVehicleSightings, vehicleTick } from "./vehicles.js";
import { detectPersons, groupCrop } from "../person-crop.js";
import type { NormBox } from "../person-crop-rules.js";
import { newVisionUpkeep, onVisionError, unverifiedText, visionUpkeepStep } from "./vision-rules.js";
import { inspectionCounters, timingLine, type VisionCall } from "./vision-timing-rules.js";

const MODE = (process.env.HUB_AGENT_SENTINEL || "on").trim().toLowerCase();
const NIGHT = sentinelNightWindow();
const MAX_PER_HOUR = Number(process.env.HUB_AGENT_SENTINEL_MAX_PER_HOUR) > 0 ? Number(process.env.HUB_AGENT_SENTINEL_MAX_PER_HOUR) : 30;
/** So viele Bewertungen laufen hoechstens gleichzeitig. */
const MAX_BUSY = 2;

export const SENTINEL = {
  enabled: MODE !== "off" && MODE !== "0",
  inspections: 0,
  alerts: 0,
  lastAt: null as string | null,
  lastVerdict: null as string | null,
};

const PROMPT =
  "Du bist der Nachtwächter einer Wasserski- und Freizeitanlage am See. Die Anlage ist gerade geschlossen. " +
  "Sieh dir dieses Überwachungsbild an. Auffällig ist: eine Person oder ein Fahrzeug auf dem Gelände, jemand an Zaun, Tor, Tür oder Fenster, " +
  "Einbruchsspuren, Feuer oder Rauch, ein Unfall, jemand im Wasser. Nicht auffällig: Tiere, Schatten, Regen, Insekten, Spiegelungen, leere Szene, " +
  "Fahrzeuge auf einer öffentlichen Straße im Hintergrund. " +
  'Antworte nur mit JSON: {"auffaellig": true|false, "was": "ein Satz auf Deutsch, was zu sehen ist", "dringlichkeit": "niedrig"|"mittel"|"hoch"}';

const PERSON_PROMPT =
  "Nahaufnahme einer Überwachungskamera auf dem Gelände einer Wasserski- und Freizeitanlage, außerhalb der Öffnungszeit. " +
  "Zähle die Personen und beurteile: Tragen sie Arbeitskleidung (Warnweste, Firmenshirt, Arbeitshose, Handschuhe)? " +
  "Wirken sie wie Mitarbeiter bei der Arbeit (Werkzeug, Schubkarre, Mäher, Reinigung, Boot, Technik)? " +
  'Was tun sie? Wähle für "handlung" genau einen Wert: "klettern" (klettert über Zaun, Tor, Mauer oder auf ein Dach), ' +
  '"tuer_fenster_schloss" (hantiert an Tür, Fenster oder Schloss), "versteckt" (versteckt sich oder duckt sich weg), ' +
  '"vermummt" (Gesicht absichtlich verdeckt, etwa mit Sturmhaube oder Maske), "traegt_etwas" (trägt Sachen weg, etwa Kisten, Kartons oder Geräte), ' +
  '"keine" (nichts davon). Trifft mehreres zu, nimm den ersten passenden Wert dieser Reihenfolge. ' +
  'Keine Handlung sind allein: ein Rucksack, eine Einkaufstasche, eine Kapuze oder Mütze bei Kälte, ein Hund an der Leine – dafür gilt "keine". ' +
  'Beschreibe jede Person kurz zur Wiedererkennung an anderen Kameras (Farbe und Art von Jacke/Oberteil, Hose, Kopfbedeckung, Tasche, Statur). ' +
  'Antworte nur mit JSON: {"personen": Zahl, "arbeitskleidung": true|false, "mitarbeiter": true|false, ' +
  '"handlung": "klettern"|"tuer_fenster_schloss"|"versteckt"|"vermummt"|"traegt_etwas"|"keine", ' +
  '"kleidung": ["Person 1: …", "Person 2: …"], "was": "ein Satz auf Deutsch"}';

let seq = 0;
/** Sperrzeiten je Kamera, laufende und wartende Bewertungen, Zaehler der Stunde (planTick). */
const queue = newQueue(Date.now());

let deps: { chatIds: () => string[] } | null = null;

/**
 * Raeume der Kamera mit Betriebszeit und ob sie geschlossen sind
 * (sentinel-rooms-rules.ts, roomsClosed): Ist der Stand der Raumdaten aelter
 * als 10 Minuten, gilt er bis zum naechsten Wechsel weiter; danach wird die
 * Kamera bewacht oder faellt auf das Nachtfenster zurueck, nie ab.
 */
function cameraRooms(cameraId: number, now = Date.now()): RoomsClosed {
  const rooms = roomsPayload().rooms.flatMap((r) =>
    r.operating && r.cameras.some((c) => c.id === cameraId)
      ? [{ name: r.name, open: r.operating.open, nextChangeAt: r.operating.nextChangeAt }]
      : []
  );
  return roomsClosed(rooms, roomsSyncedAt(), now, ROOMS_MAX_AGE_MS);
}

/** Raum(e) der Kamera geschlossen? null = keine Betriebszeit hinterlegt oder Stand unsicher (Nachtfenster). */
function cameraClosed(cameraId: number): boolean | null {
  return cameraRooms(cameraId).closed;
}

async function snap(cameraId: number): Promise<Buffer> {
  return isDoorbird(cameraId) ? captureDoorbirdSnapshot(cameraId) : captureSnapshot(cameraId);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Abstand der Blicke auf neue Gesichts-Ereignisse der Kamera. */
const FACE_POLL_MS = 2_000;

/**
 * Solange `pending()` gilt, auf ein Gesichts-Ereignis der Kamera warten, bis
 * FACE_WAIT_MS nach dem Ausloeser `at`. Die Zahl der Runden ist begrenzt auf
 * das, was in die Frist passt: Springt die Uhr des Hubs zurueck, endet das
 * Warten trotzdem nach FACE_WAIT_MS.
 */
async function waitForFace(at: number, pending: () => boolean): Promise<void> {
  for (let i = 0; i < Math.ceil(FACE_WAIT_MS / FACE_POLL_MS) && pending() && Date.now() - at < FACE_WAIT_MS; i++) await sleep(FACE_POLL_MS);
}

let hourErrorAt = 0;

/**
 * Ortszeit-Stunde fuer die Regeln. Ist sie nicht lesbar, NaN: Dann gelten
 * weder Nachtfenster noch Tagsueber-Regel, und Mitarbeiter-Eintraege zaehlen
 * nicht. Kameras in geschlossenen Raeumen werden weiter bewertet und gemeldet.
 */
function localHour(d = new Date()): number {
  try {
    return berlinHour(d);
  } catch (e) {
    if (Date.now() - hourErrorAt > 3_600_000) {
      hourErrorAt = Date.now();
      log(`Wächter: ${e instanceof Error ? e.message : e} – Regeln nach Uhrzeit ruhen`);
    }
    return NaN;
  }
}

async function inspect(where: string, title: string, at: number): Promise<InspectOutcome> {
  const cam = findCameraByRef(where);
  if (!cam) {
    log(`Wächter: ${where}: Kamera nicht mehr bekannt`);
    return "fehler";
  }
  const work = `sentinel:${cam.id}`;
  beginWork(work, `Wächter sieht sich ${cam.name} an (${title.split(/\s+/)[0].toLowerCase()})`);
  const calls: VisionCall[] = [];
  try {
    return await inspectCam(cam, title, at, calls);
  } finally {
    endWork(work);
    // Eine Zeile je Bewertung: was die Aufrufe des Bildmodells gekostet haben.
    const line = timingLine(cam.name, calls, at, VISION_NUM_CTX);
    if (line) log(line);
    for (const counter of inspectionCounters(calls, at, VISION_NUM_CTX)) improveCount("camera", counter);
  }
}

/**
 * Aufruf des Bildmodells fuer eine Bewertung, mit Zeitmessung: Dauer,
 * Zeitangaben von Ollama und die Laengen von Antwort- und Denktext kommen in
 * `calls`, auch wenn der Aufruf scheitert. Eine Antwort, die an der
 * Obergrenze abbricht (VisionCutOffError), steht mit ihren Zeitangaben da
 * und scheitert wie jeder andere Fehler.
 */
async function timedVision(calls: VisionCall[], label: string, jpeg: Buffer, prompt: string): Promise<string> {
  const started = Date.now();
  try {
    const answer = await askVisionTimed(jpeg, prompt, true);
    calls.push({ label, wallMs: answer.timing.wallMs, timing: answer.timing, output: answer.output, endedAt: Date.now() });
    return answer.text;
  } catch (e) {
    const cut = e instanceof VisionCutOffError ? e.answer : null;
    calls.push({
      label,
      wallMs: cut ? cut.timing.wallMs : Date.now() - started,
      timing: cut?.timing ?? null,
      output: cut?.output ?? null,
      cut: cut !== null,
      endedAt: Date.now(),
    });
    throw e;
  }
}

/** Ein Bild des zweiten Blicks und die Personen, die der Tracker darauf sieht (null = Bild oder Tracker fehlt). */
interface LookShot {
  jpeg: Buffer | null;
  boxes: NormBox[] | null;
}

/** Personenzahl des Trackers auf einem Bild; null = nicht geprueft. */
const trackerCount = (s: LookShot) => (s.jpeg && s.boxes ? s.boxes.length : null);

/**
 * Zweiter Blick (needsSecondLook) vorbereiten: Der Tracker prueft das erste
 * Bild, und zwei weitere Standbilder entstehen SECOND_LOOK_DELAYS_MS nach dem
 * ersten, beides neben dem Aufruf des Bildmodells. Die Standbilder kommen
 * ueber denselben Weg wie jedes Bild des Waechters (snap). Keins der
 * Versprechen scheitert: Ein fehlendes Bild ist null.
 */
function startSecondLook(cameraId: number, first: Buffer): { first: Promise<NormBox[] | null>; shots: Promise<LookShot[]> } {
  const started = Date.now();
  const firstBoxes = detectPersons(first).catch(() => null);
  const later = SECOND_LOOK_DELAYS_MS.map(async (delay): Promise<LookShot> => {
    await sleep(Math.max(0, started + delay - Date.now()));
    const jpeg = await snap(cameraId).catch(() => null);
    return { jpeg, boxes: jpeg ? await detectPersons(jpeg).catch(() => null) : null };
  });
  const shots = Promise.all([firstBoxes.then((boxes): LookShot => ({ jpeg: first, boxes })), ...later]).catch((): LookShot[] => [{ jpeg: first, boxes: null }]);
  return { first: firstBoxes, shots };
}

/** Ein Ereignis bewerten. Das Ergebnis bestimmt die Sperrzeit der Kamera (cooldownFor). */
async function inspectCam(cam: NonNullable<ReturnType<typeof findCameraByRef>>, title: string, at: number, calls: VisionCall[]): Promise<InspectOutcome> {
  let first = await snap(cam.id);
  SENTINEL.inspections++;
  const isPerson = /^PERSON\b/.test(title);
  // Nachts zaehlt bei Personen ein „unauffaellig“ erst nach einem zweiten
  // Blick (needsSecondLook). Tracker und Standbilder dafuer laufen schon jetzt,
  // damit die Bilder aus der Zeit stammen, in der die Person im Bild sein kann.
  const extra = needsSecondLook({ isPerson, gateAuffaellig: false, hour: localHour(), nightWindow: NIGHT }) ? startSecondLook(cam.id, first) : null;
  let verdict: Verdict;
  /** Das Bildmodell hat nicht geantwortet: Der Alarm geht ohne Bewertung hinaus. */
  let unverified = false;
  try {
    verdict = parseVerdict(await timedVision(calls, "Übersicht", first, PROMPT));
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    log(`Wächter: ${cam.name}: Bildmodell: ${why}`);
    recordActivity({ kind: "error", where: cam.name, text: `${cam.name}: Bild konnte nicht bewertet werden (${why})` });
    // Ohne Urteil entscheidet eine feste Regel (onVisionError): Sieht der
    // Tracker bei einem Personen-Ausloeser jemanden auf dem Standbild, oder
    // ist Nachtfenster, geht der Alarm ungeprueft hinaus. Sonst bleibt es
    // beim Befund des Zustands-Waechters (watch.ts). Ein genehmigtes Fahrzeug
    // bleibt auch dann ohne Alarm (Kennzeichen-Abgleich weiter unten).
    improveCount("camera", "sentinel_vision_error");
    const boxes = isPerson ? await (extra?.first ?? detectPersons(first)) : null;
    const seen = boxes ? boxes.length : null;
    if (onVisionError({ isPerson, trackerCount: seen, hour: localHour(), nightWindow: NIGHT }) === "befund") return "fehler";
    unverified = true;
    verdict = { auffaellig: true, was: unverifiedText(isPerson, seen), dringlichkeit: "mittel" };
  }
  SENTINEL.lastAt = new Date().toISOString();
  SENTINEL.lastVerdict = `${cam.name}: ${unverified ? "ungeprüft" : verdict.auffaellig ? "auffällig" : "unauffällig"} – ${verdict.was}`;
  if (!unverified) improve("camera", verdict.auffaellig ? "sentinel_alert" : "sentinel_calm", { camera: cam.name, trigger: title });
  /** Zusatzzeilen fuer den Alarmtext. */
  const notes: string[] = [];
  /** Tracker-Ergebnis zu `first`, wenn der zweite Blick es schon geliefert hat. */
  let preset: NormBox[] | null | undefined;
  if (!verdict.auffaellig) {
    const shots = extra ? await extra.shots : null;
    const look2 = shots ? secondLookResult(shots.map(trackerCount)) : null;
    const calm = () => afterCalm({ isPerson, secondLook: look2, faceSeenAt: faceSeenAt(cam.name), triggerAt: at });
    let next = calm();
    // Bei einer Person wartet „unauffaellig“ auf ein Gesichts-Ereignis der
    // Kamera (die Gesichtserkennung meldet einige Sekunden nach dem Ausloeser).
    if (isPerson) {
      await waitForFace(at, () => calm().then === "unauffaellig");
      next = calm();
    }
    if (next.then === "unauffaellig") {
      log(`Wächter: ${cam.name} (${title}) unauffällig: ${verdict.was}` + (shots ? ` [Tracker: ${shots.length} Bilder ohne Person]` : ""));
      if (shots) improveCount("camera", "sentinel_second_look_leer");
      recordActivity({ kind: "watch", where: cam.name, text: `${cam.name}: unauffällig – ${verdict.was}`, jpeg: first });
      return "unauffaellig";
    }
    // Nachts und der Tracker sieht jemanden (oder konnte nicht jedes Bild
    // pruefen) oder die Gesichtserkennung hat an der Kamera ein Gesicht
    // gefunden: Die Bewertung laeuft mit dem Bild weiter, auf dem der Tracker
    // die Person sieht, sonst mit dem ersten.
    const shot = shots?.[next.then === "tracker" ? next.shot : 0] ?? null;
    if (shot) {
      if (shot.jpeg) first = shot.jpeg;
      preset = shot.boxes;
    }
    if (next.then === "tracker") {
      log(
        `Wächter: ${cam.name} (${title}): Bildmodell unauffällig (${verdict.was}), Tracker sieht ${shot?.boxes?.length ?? 0} Person(en) ` +
          `auf Bild ${next.shot + 1} von ${shots?.length ?? 0} – Bewertung läuft weiter`
      );
      notes.push("Das Bildmodell sah zuerst niemanden, der Tracker schon.");
      improveCount("camera", "sentinel_second_look_person");
    } else if (next.then === "gesicht") {
      log(`Wächter: ${cam.name} (${title}): Bildmodell unauffällig (${verdict.was}), die Gesichtserkennung hat aber ein Gesicht gefunden – Bewertung läuft weiter`);
      notes.push("Das Bildmodell sah niemanden, die Gesichtserkennung hat aber ein Gesicht gefunden.");
      improveCount("camera", "sentinel_calm_face");
    } else {
      log(`Wächter: ${cam.name} (${title}): Bildmodell unauffällig (${verdict.was}), Tracker konnte nicht jedes Bild prüfen – Bewertung läuft weiter`);
      notes.push("Das Bildmodell sah niemanden, der Tracker konnte das nicht bestätigen.");
      improveCount("camera", "sentinel_second_look_offen");
    }
    verdict = { ...verdict, auffaellig: true, was: `Personen-Signal der Kamera; Bildmodell zuerst: ${verdict.was}` };
    SENTINEL.lastVerdict = `${cam.name}: zweiter Blick – ${verdict.was}`;
  }
  // Fahrzeug: kurz auf die Kennzeichen-Erkennung warten. Genehmigt → kein Alarm.
  if (/^VEHICLE\b/.test(title)) {
    let known: boolean | null = null;
    for (let i = 0; i < 6 && known === null; i++) {
      known = cameraSawKnownPlate(cam.name, at);
      if (known === null) await sleep(2_000);
    }
    if (known) {
      log(`Wächter: ${cam.name}: genehmigtes Fahrzeug – kein Alarm`);
      SENTINEL.lastVerdict = `${cam.name}: genehmigtes Fahrzeug`;
      recordActivity({ kind: "detect", where: cam.name, text: `${cam.name}: genehmigtes Fahrzeug – kein Alarm`, jpeg: first });
      return "kein_alarm";
    }
  }
  const caps = isDoorbird(cam.id) ? null : await getCameraCaps(cam.id).catch(() => null);

  // Person: heranzoomen, genauer ansehen, mit Stempeldaten/Gesicht abgleichen.
  let close: Buffer | null = null;
  let reason = "";
  let personKleidung: string[] = [];
  /** Fuer die Dringlichkeit (alarmLevel): Grund, Handlung und Liste des Gesichts-Treffers. */
  let alarmBasis: AlarmBasis | null = null;
  let alarmAction: Handlung | null = null;
  let faceList: string | null = null;
  // Ohne Bildmodell gibt es keine Nahaufnahme-Bewertung und keine
  // Kleidungs-Merkliste: Der ungepruefte Alarm geht mit dem Standbild hinaus.
  if (isPerson && !unverified) {
    // Ist ueberhaupt jemand im Bild? Der Tracker (YOLO) zaehlt Personen. Sieht
    // er auf zwei Bildern niemanden und hat die Gesichtserkennung an der
    // Kamera kein Gesicht gemeldet, war es eine Fehlausloesung oder die Person
    // ist schon weg – dann kein Alarm mit leerem Bild (trackerVeto).
    let boxes = preset !== undefined ? preset : await (extra?.first ?? detectPersons(first));
    if (boxes && boxes.length === 0 && extra && preset === undefined) {
      // Nachts liegen schon zwei weitere Bilder vor: Zeigt eins eine Person, geht es damit weiter.
      const shots = await extra.shots;
      const found = secondLookResult(shots.map(trackerCount));
      const shot = typeof found === "number" ? shots[found] : null;
      if (shot?.jpeg && shot.boxes?.length) {
        log(`Wächter: ${cam.name}: Tracker sieht ${shot.boxes.length} Person(en) erst auf Bild ${(found as number) + 1} von ${shots.length}`);
        first = shot.jpeg;
        boxes = shot.boxes;
      }
    }
    if (boxes && boxes.length === 0) {
      await sleep(1_500);
      const again = await snap(cam.id).catch(() => null);
      const b2 = again ? await detectPersons(again) : null;
      if (again && b2?.length) {
        first = again;
        boxes = b2;
      } else {
        const firstCount = boxes.length;
        const veto = () => trackerVeto({ first: firstCount, second: b2 ? b2.length : null, faceSeenAt: faceSeenAt(cam.name), triggerAt: at });
        // Gesichts-Ereignisse kommen einige Sekunden nach dem Ausloeser: so
        // lange (bis FACE_WAIT_MS nach dem Ausloeser) wartet das Veto darauf.
        await waitForFace(at, veto);
        if (veto()) {
          log(`Wächter: ${cam.name}: Tracker sieht keine Person (2 Bilder) – kein Alarm (Bildmodell: ${verdict.was})`);
          SENTINEL.lastVerdict = `${cam.name}: keine Person im Bild`;
          recordActivity({ kind: "watch", where: cam.name, text: `${cam.name}: Personen-Signal, aber niemand im Bild – kein Alarm` });
          improve("camera", "sentinel_person_empty", { camera: cam.name });
          return "tracker_leer";
        }
        if (b2) {
          // Beide Bilder leer, aber ein Gesicht: weiter mit dem Uebersichtsbild.
          log(
            `Wächter: ${cam.name}: Tracker sieht keine Person (2 Bilder), die Gesichtserkennung hat aber ein Gesicht gefunden – ` +
              `Bewertung läuft mit dem Übersichtsbild weiter (Bildmodell: ${verdict.was})`
          );
          notes.push("Der Tracker sieht niemanden, die Gesichtserkennung hat aber ein Gesicht gefunden.");
          improveCount("camera", "sentinel_tracker_face");
        }
      }
    }
    // Nahaufnahme: optisch, wenn die Kamera ein Zoom-Objektiv hat, sonst
    // digitaler Ausschnitt um die gefundenen Personen.
    if (boxes?.length) {
      const optical = isDoorbird(cam.id) ? null : await personCloseUp(cam.id).catch(() => null);
      close = optical?.jpeg ?? (await groupCrop(first, boxes));
      log(
        `Wächter: ${cam.name}: ${optical ? `optischer Zoom ×${optical.gain.toFixed(1)}` : "digitaler Zoom"} auf ${boxes.length} Person(en)` +
          (close ? "" : " (Ausschnitt lohnt nicht)")
      );
    }
    // Mitarbeiter-Eintraege zaehlen im Nachtfenster nicht als bekannt: Das
    // Bildmodell bekommt dann nur die uebrigen Eintraege zum Abgleich.
    const listHour = localHour();
    const remembered = await activeCleared();
    const known = remembered.filter((c) => knownUsable(c, listHour, NIGHT));
    const resting = remembered.length - known.length;
    let look: PersonLook | null = null;
    try {
      look = parsePersonLook(await timedVision(calls, "Nahaufnahme", close ?? first, PERSON_PROMPT + knownPrompt(known)));
    } catch (e) {
      log(`Wächter: ${cam.name}: Nahaufnahme: ${e instanceof Error ? e.message : e}`);
    }
    let face = faceAt(cam.name, at);
    for (let i = 0; i < 3 && !face && Date.now() - at < 12_000; i++) {
      await sleep(2_000);
      face = faceAt(cam.name, at);
    }
    const staff = await staffClockedIn();
    const hour = localHour();
    const decision = decidePerson({
      face,
      staff,
      look,
      hour,
      known: known.map(clearedTitle),
      knownKinds: known.map((c) => c.kind),
      tracked: boxes?.length ?? null,
      // „Nahaufnahme ohne Person“ entwarnt nicht, wenn Gesicht oder (nachts) Tracker jemanden belegen.
      presence: emptyLookOverruled({ trackerCount: boxes?.length ?? null, faceSeenAt: faceSeenAt(cam.name), triggerAt: at, hour, nightWindow: NIGHT }),
    });
    reason = decision.reason;
    log(
      `Wächter: ${cam.name} Person: ${decision.alarm ? "ALARM" : "kein Alarm"} – ${decision.reason}` +
        (look
          ? ` (${look.personen} Pers., Arbeitskleidung ${look.arbeitskleidung ? "ja" : "nein"}` +
            (look.handlung !== "keine" ? `, Handlung ${look.handlung}` : "") +
            `: ${look.was})`
          : "") +
        (resting ? ` [${resting} ${resting === 1 ? "Mitarbeiter-Eintrag zählt" : "Mitarbeiter-Einträge zählen"} im Nachtfenster nicht]` : "")
    );
    improve("camera", decision.alarm ? "sentinel_person_alarm" : "sentinel_person_staff", { camera: cam.name, reason });
    personKleidung = look?.kleidung ?? [];
    if (!decision.alarm) {
      // Fuer die anderen Kameras merken (Regeln in people-rules.ts):
      // wiedererkannte verlaengern, eine einzelne neue Person dazu.
      const matched = (look?.bekannt ?? []).map((b) => known[b - 1]).filter(Boolean);
      // Den Namen nennt nur ein starker Treffer; ein schwacher bleibt „vermutlich bekannt“.
      const faceName = decision.basis === "gesicht" ? (face?.name ?? null) : null;
      const label = faceName ?? (decision.basis === "hinweis" ? "vermutlich bekannt" : staff?.length ? "Mitarbeiter" : matched[0]?.label ?? "unbedenklich");
      const kept = await rememberSeen({
        camera: cam.name,
        basis: decision.basis,
        faceName,
        persons: look?.personen ?? null,
        tracked: boxes?.length ?? null,
        unknown: look?.unbekannt ?? 0,
        kleidung: look?.kleidung ?? [],
        matched,
      });
      if (kept.promoted) {
        log(`Wächter: ${cam.name}: gemeldete Person ist jetzt als ${decision.basis === "gesicht" ? "freigegeben" : "Mitarbeiter"} gemerkt`);
        improveCount("camera", "sentinel_known_promoted");
      }
      if (kept.withheld) {
        log(`Wächter: ${cam.name}: mehrere Personen im Bild – keine neue Beschreibung gemerkt`);
        improveCount("camera", "sentinel_known_withheld");
      }
      SENTINEL.lastVerdict = `${cam.name}: vermutlich Mitarbeiter – ${decision.reason}`;
      recordActivity({ kind: "detect", where: cam.name, text: `${cam.name}: ${label} – ${decision.reason}, kein Alarm`, jpeg: close ?? first });
      recordHubEvent({ kind: "camera", severity: "info", where: cam.name, title: "Assistent: vermutlich Mitarbeiter", detail: decision.reason });
      return decision.basis === "leer" ? "nahaufnahme_leer" : "kein_alarm";
    }
    alarmBasis = decision.basis;
    alarmAction = look?.handlung ?? null;
    faceList = face?.list ?? null;
    if (look?.was) verdict = { ...verdict, was: look.was };
    // Gemeldete Personen 20 Minuten merken: dieselbe Person an der naechsten
    // Kamera loest keinen neuen Alarm aus (ausser bei einer Handlung, die
    // decidePerson ohne Freigabe als Alarm wertet).
    // Die Frist laeuft ab dem Alarm und wird beim Wiedersehen nicht laenger.
    if (look?.kleidung.length && look.unbekannt > 0) await rememberReported(cam.name, look.kleidung);
  }

  SENTINEL.alerts++;
  // Dringend: im Nachtfenster, bei gesperrter Person oder harter Handlung (alarmLevel).
  const level = alarmLevel({ hour: localHour(), nightWindow: NIGHT, reason: alarmBasis, handlung: alarmAction, list: faceList, dringlichkeit: verdict.dringlichkeit });
  log(
    `Wächter: ${cam.name} AUFFÄLLIG (${unverified ? "ungeprüft" : verdict.dringlichkeit}): ${verdict.was}` +
      (level.marks.length ? ` [dringend: ${level.marks.join(", ")}]` : "")
  );
  if (level.marks.length) improveCount("camera", "sentinel_alarm_dringend");
  if (unverified) improve("camera", "sentinel_unverified", { camera: cam.name, trigger: title });
  recordHubEvent({ kind: "camera", severity: "alert", where: cam.name, title: "Assistent: auffällig", detail: verdict.was });
  const followed = cameraFollowing(cam.id);

  // Knoepfe ohne Zustand im Hub (alarm-rules.ts): Kamera und Frist stehen in
  // ihren Daten, die Frist zaehlt ab dem Sendeversuch der Nachricht, die
  // ankommt. Neues Bild gilt unbegrenzt, Licht an 60 Minuten, Sirene 10.
  // Geschaltet wird nur durch einen Tipp aus einem gekoppelten Chat (agent.ts).
  const okData = personKleidung.length ? await offerPersonOk(cam.name, personKleidung) : null;
  const lights = { spotlight: !!caps?.spotlight, siren: !!caps?.siren };
  const buttons = (sentAt: number): TgButton[][] => [
    alarmButtonRow(cam.id, lights, sentAt),
    ...(okData ? [[{ text: "Ist in Ordnung", callback_data: okData }]] : []),
  ];

  const time = new Date().toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
  const caption =
    `${alarmHead(level, cam.name, time)}: ${verdict.was}` +
    (reason ? `\n${reason}.` : "") +
    notes.map((n) => `\n${n}`).join("") +
    (followed ? "\nKamera folgt der Person." : "");
  // Alarm und Zusatzbilder gehen in die Sende-Warteschlange (dispatch.ts): je
  // Chat in dieser Reihenfolge, mit Wiederholung, wenn Telegram nicht
  // erreichbar ist. Die Bewertung wartet nicht auf die Zustellung. Nur der
  // Alarm selbst kommt mit Ton, Uebersicht und Bildserie ohne.
  const ids = deps?.chatIds() ?? [];
  const sent = sendAlarm({ chatIds: ids, camera: cam.name, jpeg: close ?? first, caption, buttons });
  if (close) sendAlarmImage({ chatIds: ids, jpeg: first, caption: `${cam.name} · Übersicht`, alarm: sent });

  // Bildserie: zwei weitere Bilder, damit der Verlauf zu sehen ist.
  for (let i = 1; i <= 2; i++) {
    await sleep(4_000);
    try {
      const jpeg = await snap(cam.id);
      // Bei Personen nur Bilder schicken, auf denen der Tracker noch jemanden sieht.
      if (isPerson && (await detectPersons(jpeg))?.length === 0) continue;
      sendAlarmImage({ chatIds: ids, jpeg, caption: `${cam.name} · +${i * 4} s`, alarm: sent });
    } catch {
      break;
    }
  }
  // Nach einem ungeprueften Alarm gilt die Sperrzeit wie nach einem Fehler:
  // Im Nachtfenster sieht der Waechter nach 45 Sekunden wieder hin (cooldownFor).
  return unverified ? "fehler" : "alarm";
}

const SKIP_REASONS: SkipReason[] = ["abstand", "limit", "belegt"];

/** Was der Takt zum Bildmodell behaelt: der zuletzt geloggte Stand und der Beginn des letzten Wiederanlaufs. */
const visionState = newVisionUpkeep();

/**
 * Bildmodell im Takt beobachten (vision-rules.ts, visionUpkeepStep): Solange
 * es nicht bereit ist, wird es hoechstens alle 5 Minuten neu bereitgestellt,
 * nie neben einem laufenden Versuch und nicht, waehrend das Sprachmodell
 * eingerichtet wird (ensureOllama stellt das Bildmodell danach selbst
 * bereit). Der Takt wartet nicht auf das Ergebnis. Ist der Waechter mit
 * Bildern eingeschaltet, steht im Log eine Zeile, wenn das Bildmodell
 * ausfaellt, und eine, wenn es wieder bereit ist.
 */
function visionUpkeep(now: number): void {
  if (!VISION.enabled) return;
  const step = visionUpkeepStep(
    visionState,
    { ready: VISION.ready, sinceMs: now - VISION.since, busy: VISION.installing || LLM.installing, error: VISION.error },
    now,
    SENTINEL.enabled
  );
  if (step.line) log(step.line);
  if (!step.retry) return;
  improveCount("camera", "sentinel_vision_retry");
  void ensureVisionModel().catch((e) => log(`Wächter: Bildmodell: ${e instanceof Error ? e.message : e}`));
}

/** Bewertung im Hintergrund ausfuehren; ihr Ergebnis bestimmt die Sperrzeit der Kamera. */
function runInspection(started: StartedInspection): void {
  const { where, title, seenAt, camId } = started.trigger;
  const person = /^PERSON\b/.test(title);
  // Fuer die Liste der bewachten Kameras: Diese Bewertung gilt der Person, die die Kamera gerade sieht.
  if (person) lastPerson.set(camId, { at: started.mark.at, outcome: null });
  void inspect(where, title, seenAt)
    .catch((e): InspectOutcome => {
      log(`Wächter: ${where}: ${e instanceof Error ? e.message : e}`);
      return "fehler";
    })
    .then((outcome) => {
      finishInspection(queue, started, outcome, localHour(), NIGHT);
      if (person && lastPerson.get(camId)?.at === started.mark.at) lastPerson.set(camId, { at: started.mark.at, outcome });
      improveCount("camera", `sentinel_result_${outcome}`);
    })
    .catch((e) => log(`Wächter: ${e instanceof Error ? e.message : e}`));
}

/** Beginn des offenen Personen-Ereignisses je Kamera („PERSON erkannt“, noch nicht beendet). */
const personSince = new Map<number, number>();
/** Letzte Bewertung eines Personen-Ausloesers je Kamera: Beginn und Ergebnis (null = laeuft). */
const lastPerson = new Map<number, { at: number; outcome: InspectOutcome | null }>();

/** Offene Personen-Ereignisse je Kamera aus den Hub-Ereignissen nachfuehren (cameraDuty). */
function notePersonPresence(events: readonly HubEvent[], now: number): void {
  for (const ev of events) {
    if (ev.kind !== "camera" || !ev.where) continue;
    const phase = /^PERSON (erkannt|beendet)$/.exec(ev.title)?.[1];
    const cam = phase ? findCameraByRef(ev.where) : null;
    if (!cam) continue;
    if (phase === "erkannt") personSince.set(cam.id, now);
    else personSince.delete(cam.id);
  }
}

/** Was der Waechter an der Kamera gerade tut (cameraDuty), mit denselben Sperrzeiten wie planTick. */
function dutyOf(id: number, now: number): CameraDuty {
  const mark = queue.marks.get(id);
  const earlyAllowed = inspectionsInLastHour(queue.recent, now) + inspectionsInLastHour(queue.early, now) < MAX_PER_HOUR;
  return cameraDuty({
    now,
    personSince: personSince.get(id) ?? null,
    lastPerson: lastPerson.get(id) ?? null,
    locked: mark !== undefined && now - mark.at < lockMs(mark, earlyAllowed),
    waiting: queue.waiting.some((w) => w.camId === id),
    slotFree: queue.busy < MAX_BUSY,
  });
}

/** Je Kamera der Beginn der Personen-Bewertung, die schon als ohne Ergebnis im Log steht. */
const staleLogged = new Map<number, number>();

/**
 * Personen-Bewertungen, die laenger als INSPECT_COVER_MAX_MS ohne Ergebnis
 * laufen, einmal ins Log: Sie zaehlen nicht mehr als „bewertet“ (cameraDuty),
 * die Kamera faellt aus der Liste, und die Cloud meldet dort wieder selbst.
 */
function noteStaleInspections(now: number): void {
  for (const [camId, p] of lastPerson) {
    if (p.outcome !== null || now - p.at <= INSPECT_COVER_MAX_MS || staleLogged.get(camId) === p.at) continue;
    staleLogged.set(camId, p.at);
    const name = findCameraByRef(String(camId))?.name ?? `Kamera ${camId}`;
    log(`Wächter: ${name}: Bewertung läuft seit über ${INSPECT_COVER_MAX_MS / 60_000} min ohne Ergebnis; sie gilt nicht mehr als Bewertung der Person, die Cloud meldet dort selbst`);
    improveCount("camera", "sentinel_inspect_stale");
  }
}

/** Einstellung „Wächter“ je Kamera beim letzten Takt; null = noch kein Takt. */
let modes: Map<number, SentinelMode> | null = null;

/** Abweichende Einstellungen beim Start und jede Aenderung einmal ins Log. */
function noteModes(): void {
  const cams = listCameraConfigs().map((c) => ({ id: c.id, name: c.name, mode: readSentinelMode(c.sentinelMode) }));
  const r = sentinelModeLines(modes, cams, NIGHT);
  for (const line of r.lines) log(line);
  modes = r.next;
}

/** Bewachte Kameras beim letzten Takt (sentinel-cover-rules.ts); null = noch kein Takt. */
let coverage: Coverage | null = null;
let coverageShrinkListener: (() => void) | null = null;

/** Grund, aus dem keine Kamera mehr in die Liste fuer die Cloud kommt (Neustart steht an); null = keiner. */
let coverageHold: string | null = null;

/**
 * Was das Lebenszeichen der Cloud meldet: die Kameras, die der Waechter beim
 * letzten Takt nachweislich bewacht hat, mit dessen Zeitpunkt. Lief der Takt
 * seit 30 s nicht oder steht ein Neustart an, ist die Liste leer.
 */
export function sentinelCoverage(now = Date.now()): { at: string; cameras: number[] } {
  return coverageReport(coverageHold ? null : coverage, now);
}

/**
 * Beleg fuer eine Personen-Sichtung an der Kamera (vouchFor): Liste nicht
 * gesperrt, letzter Takt hoechstens 30 s alt, Kamera in seiner Liste, und der
 * Stand der Kamera von jetzt (nicht der des letzten Takts) ist „bewertet“
 * oder „gemeldet“. cameras.ts fragt das ueber sentinel-vouch.ts ab.
 */
function vouchNow(cameraId: number, now = Date.now()): Vouch {
  return vouchFor({ hold: coverageHold, last: coverage, now, cameraId, duty: dutyOf(cameraId, now) });
}

/**
 * Ab jetzt keine Kamera mehr in der Liste fuer die Cloud (vor dem Neustart
 * nach einem Update): Die Cloud meldet dann selbst, auch was eine Bewertung
 * erst nach dem Neustart melden koennte.
 */
export function holdSentinelCoverage(reason: string): void {
  coverageHold = reason;
}

/** Laufende Bewertungen (fuer den Neustart nach einem Update, updater.ts). */
export function sentinelBusy(): number {
  return queue.busy;
}

/** Wird aufgerufen, wenn eine Kamera aus der Liste faellt (das Lebenszeichen geht dann sofort hinaus). */
export function onCoverageShrink(listener: () => void): void {
  coverageShrinkListener = listener;
}

/** Einstellung und Raeume jeder Kamera fuer diesen Takt. */
function guardCameras(now: number): GuardCamera[] {
  return listCameraConfigs().map((c) => ({ id: c.id, name: c.name, mode: readSentinelMode(c.sentinelMode), rooms: cameraRooms(c.id, now) }));
}

/**
 * Liste der bewachten Kameras fuer diesen Takt festhalten (coveredCameras).
 * Jede Aenderung steht im Log; faellt eine Kamera weg, erfaehrt es die Cloud
 * mit dem naechsten Lebenszeichen sofort.
 */
function noteCoverage(now: number, hour: number, cams: readonly GuardCamera[]): void {
  const next = coveredCameras({
    enabled: SENTINEL.enabled,
    paired: (deps?.chatIds().length ?? 0) > 0,
    delivery: coverageHold ?? alarmDeliveryTrouble(now),
    visionReady: VISION.enabled && VISION.ready,
    visionFailStreak: VISION.failStreak,
    inspectionsLastHour: inspectionsInLastHour(queue.recent, now),
    maxPerHour: MAX_PER_HOUR,
    always: MODE === "always",
    hour,
    nightWindow: NIGHT,
    cams: cams.map((c) => ({ id: c.id, mode: c.mode, roomClosed: c.rooms.closed, duty: dutyOf(c.id, now) })),
  });
  const prev = coverage?.cameras ?? null;
  const line = coverageLine(
    prev,
    next,
    new Map(cams.map((c) => [c.id, c.name])),
    cloudQuietOn(process.env.HUB_SENTINEL_CLOUD_QUIET),
  );
  if (line) log(line);
  coverage = { at: now, cameras: next.cameras };
  if (prev && coverageShrank(prev, next.cameras)) coverageShrinkListener?.();
}

/** Bewachungs-Zustand je Kamera beim letzten Takt; null = noch nicht geloggt. */
let guarded: Map<number, boolean> | null = null;

/**
 * Bewachungs-Zustand je Kamera ins Log (guardChangeLines): beim Start eine
 * Uebersicht, danach jeder Wechsel mit Grund. Nur, wenn der Waechter mit
 * Bildern laeuft; ob das Bildmodell gerade bereit ist, steht in der Zeile
 * zur Liste fuer die Cloud (noteCoverage).
 */
function noteGuard(hour: number, cams: readonly GuardCamera[]): void {
  // Ohne Kameras (Liste noch nicht geladen) bleibt die Uebersicht fuer den Start aufgehoben.
  if (!SENTINEL.enabled || !VISION.enabled || !cams.length) return;
  const r = guardChangeLines(
    guarded,
    cams.map((c) => guardState(c, { always: MODE === "always", hour, nightWindow: NIGHT }))
  );
  for (const line of r.lines) log(line);
  guarded = r.next;
}

/**
 * Zeile „Heute bewacht: …“ fuer die Tagesvorschau (guardTodayLine): je Raum
 * die Zeit ausserhalb seiner Oeffnungsspannen von heute, sonst das
 * Nachtfenster. Fehlen die Spannen, steht der Zustand von jetzt da.
 */
export function sentinelTodayLine(now = Date.now()): string {
  const hour = localHour(new Date(now));
  const ctx = { always: MODE === "always", hour, nightWindow: NIGHT };
  const rooms = roomsPayload().rooms;
  const synced = roomsSyncedAt();
  return guardTodayLine({
    enabled: SENTINEL.enabled,
    visionEnabled: VISION.enabled,
    always: ctx.always,
    nightWindow: NIGHT,
    today: berlinClock(now)?.ymd ?? "",
    roomsDay: synced !== null ? (berlinClock(synced)?.ymd ?? null) : null,
    cams: guardCameras(now).map((c) => ({
      id: c.id,
      name: c.name,
      mode: c.mode,
      rooms: rooms.flatMap((r) => (r.operating && r.cameras.some((x) => x.id === c.id) ? [{ name: r.name, spans: r.operating.spans }] : [])),
      watchedNow: guardState(c, ctx).watched,
    })),
  });
}

/** Fahrzeug-Ereignisse fuer den naechsten Lauf der Kennzeichen-Fragen (vehicleTick). */
let vehicleBacklog: HubEvent[] = [];
/** Ein Lauf von vehicleTick ist unterwegs. */
let vehicleRunning = false;
/** Im laufenden Lauf aus dem Puffer verworfene Fahrzeug-Ereignisse. */
let vehicleDropped = 0;
/** Ab dieser Dauer steht ein Lauf im Log (so lange haette er frueher den Takt angehalten und die Liste fuer die Cloud geleert). */
const VEHICLE_RUN_SLOW_MS = 30_000;

/**
 * Kennzeichen-Fragen neben dem Takt (vehicleTick): hoechstens ein Lauf zur
 * Zeit, nicht abgewartet. Eine Frage, die auf Telegram oder ein Kamerabild
 * wartet, haelt so den Waechter nicht an. Fahrzeug-Ereignisse, die waehrend
 * eines Laufs kommen, sammelt ein Puffer (appendBacklog, hoechstens
 * VEHICLE_BACKLOG_MAX; die aeltesten fallen weg und werden gezaehlt), der
 * naechste Lauf arbeitet sie ab. vehicleTick laeuft auch ohne neue
 * Ereignisse in jedem Takt: Fragen, die auf das Ende der Ruhezeit warten,
 * gehen dann hinaus.
 */
function vehicleRun(events: readonly HubEvent[]): void {
  if (!deps) return;
  const add = events.filter((ev) => ev.kind === "vehicle");
  if (add.length) {
    const r = appendBacklog(vehicleBacklog, add);
    vehicleBacklog = r.list;
    if (r.dropped) {
      if (vehicleDropped === 0) {
        log(`Assistent: Kennzeichen: Puffer voll, der letzte Lauf ist noch nicht fertig; die ältesten Fahrzeug-Ereignisse fallen weg (höchstens ${VEHICLE_BACKLOG_MAX} warten)`);
      }
      vehicleDropped += r.dropped;
      for (let i = 0; i < r.dropped; i++) improveCount("agent", "vehicle_backlog_dropped");
    }
  }
  if (vehicleRunning) return;
  vehicleRunning = true;
  const batch = vehicleBacklog;
  vehicleBacklog = [];
  const started = Date.now();
  void vehicleTick(batch, deps.chatIds())
    .catch((e) => log(`Assistent: Kennzeichen: ${e instanceof Error ? e.message : e}`))
    .finally(() => {
      vehicleRunning = false;
      const took = Date.now() - started;
      if (took >= VEHICLE_RUN_SLOW_MS || vehicleDropped > 0) {
        log(
          `Assistent: Kennzeichen-Lauf dauerte ${Math.round(took / 1000)} s, der Wächter-Takt lief weiter` +
            (vehicleDropped > 0 ? ` (${vehicleDropped} Fahrzeug-Ereignisse aus dem Puffer verworfen)` : "")
        );
      }
      if (took >= VEHICLE_RUN_SLOW_MS) improveCount("agent", "vehicle_run_slow");
      vehicleDropped = 0;
    });
}

async function tick(): Promise<void> {
  const events = hubEventsSince(seq);
  seq = currentEventSeq();
  notePersonEvents(events);
  // Kennzeichen: das letzte je Kamera sofort (fuer die Bewertung eines
  // Fahrzeugs), die Fragen in einem eigenen Lauf, auf den der Takt nicht wartet.
  noteVehicleSightings(events);
  vehicleRun(events);
  const now = Date.now();
  // Hoechstens eine Bilanz-Zeile je Stunde, nur fuer Stunden mit mindestens einem Ausloeser.
  for (const done of dueTallies(queue, now)) {
    const line = tallyLine(done, localHour(new Date(done.start)));
    if (line) log(line);
  }
  visionUpkeep(now);
  if (SENTINEL.enabled) noteModes();
  const hour = localHour();
  const cams = guardCameras(now);
  notePersonPresence(events, now);
  noteGuard(hour, cams);
  // Ohne bereites Bildmodell wird nichts bewertet; der Zustands-Waechter meldet den Ausfall (watch.ts).
  if (SENTINEL.enabled && VISION.ready) planAndStart(now, hour, events);
  // Die Liste fuer die Cloud erst nach dem Plan: Eine eben begonnene Bewertung zaehlt schon mit.
  noteStaleInspections(now);
  noteCoverage(now, hour, cams);
}

/** Ausloeser dieses Takts einplanen und die Bewertungen starten (planTick). */
function planAndStart(now: number, hour: number, events: readonly HubEvent[]): void {
  const plan = planTick(queue, {
    now,
    hour,
    nightWindow: NIGHT,
    maxPerHour: MAX_PER_HOUR,
    maxBusy: MAX_BUSY,
    events: events.flatMap((ev) => {
      const cam = ev.where && isTriggerEvent(ev) ? findCameraByRef(ev.where) : null;
      if (!cam || !ev.where) return [];
      // Einstellung „Wächter“ der Kamera: aus = nicht bewerten, nur nachts = allein das Nachtfenster, auch mit always.
      const mode = readSentinelMode(cam.sentinelMode);
      const closed = sentinelClosed(mode, cameraClosed(cam.id), hour);
      return closed === "aus" ? [] : [{ ev, camId: cam.id, where: ev.where, closed, always: modeAlways(mode, MODE === "always") }];
    }),
  });
  // Zuerst starten: Zu jedem Platz, den der Plan belegt hat, laeuft dann auch eine Bewertung.
  for (const started of plan.start) runInspection(started);
  for (let i = 0; i < plan.triggers; i++) improveCount("camera", "sentinel_trigger");
  for (const reason of SKIP_REASONS) for (let i = 0; i < plan.skipped[reason]; i++) improveCount("camera", `sentinel_skip_${reason}`);
  for (const w of plan.expired) log(`Wächter: ${w.where}: Auslöser verfallen, ${RETRY_MAX_AGE_MS / 1000} s lang kein Platz für die Bewertung frei`);
  for (const started of plan.start) {
    const waited = now - started.trigger.seenAt;
    if (waited > 0) {
      log(`Wächter: ${started.trigger.where}: zurückgestellter Auslöser wird bewertet (${Math.round(waited / 1000)} s gewartet)`);
      improveCount("camera", "sentinel_retry");
    }
    if (started.early) improveCount("camera", "sentinel_early");
  }
}

export function startSentinel(d: { chatIds: () => string[] }): void {
  deps = d;
  seq = currentEventSeq();
  setSentinelVouch((cameraId) => vouchNow(cameraId));
  // Schwenk-Kameras folgen nur bei geschlossenem Raum (camera-motion.ts):
  // derselbe Stand, nach dem der Waechter bewacht.
  setCameraRoomClosed((cameraId) => cameraClosed(cameraId));
  log(
    cloudQuietOn(process.env.HUB_SENTINEL_CLOUD_QUIET)
      ? "Wächter: Cloud schweigt zu unbekannten Personen, die der Wächter nachweislich bewertet (HUB_SENTINEL_CLOUD_QUIET=on)"
      : "Wächter: Cloud meldet unbekannte Personen weiter selbst (HUB_SENTINEL_CLOUD_QUIET aus, Standard)"
  );
  if (!SENTINEL.enabled) log("Wächter mit Bildern: aus (HUB_AGENT_SENTINEL=off)");
  else if (!VISION.enabled) log("Wächter mit Bildern: ruht, das Bildmodell ist abgeschaltet (HUB_AGENT_VISION=0)");
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void tick()
      .catch((e) => log(`Wächter: ${e instanceof Error ? e.message : e}`))
      .finally(() => (running = false));
  }, 3_000);
}
