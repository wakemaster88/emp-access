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
 * Mit Knopf in Telegram (Aaron entscheidet): Scheinwerfer, Sirene, neues Bild.
 * Nie automatisch: Tor oeffnen, Sirene, Licht, Netzwerk.
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
 * gekostet haben (Zeitangaben von Ollama, vision-timing-rules.ts).
 */
import { log } from "../config.js";
import { currentEventSeq, hubEventsSince, recordHubEvent } from "../state.js";
import { captureSnapshot, cameraFollowing, findCameraByRef, getCameraCaps, personCloseUp } from "../cameras.js";
import { captureDoorbirdSnapshot, isDoorbird } from "../doorbird.js";
import { roomsPayload } from "../rooms.js";
import { improve, improveCount } from "../improve-log.js";
import { LLM, VISION, VISION_NUM_CTX, askVisionTimed, ensureVisionModel } from "./ollama.js";
import { sendAlarm, sendAlarmImage } from "./dispatch.js";
import { beginWork, endWork, recordActivity } from "./activity.js";
import type { TgButton } from "./telegram.js";
import { berlinHour } from "./quiet.js";
import {
  RETRY_MAX_AGE_MS,
  decidePerson,
  dueTallies,
  finishInspection,
  isTriggerEvent,
  newQueue,
  parsePersonLook,
  parseVerdict,
  planTick,
  tallyLine,
  type InspectOutcome,
  type PersonLook,
  type SkipReason,
  type StartedInspection,
  type Verdict,
} from "./sentinel-rules.js";
import { activeCleared, clearedTitle, faceAt, knownPrompt, notePersonEvents, offerPersonOk, rememberReported, rememberSeen, staffClockedIn } from "./people.js";
import { knownUsable } from "./people-rules.js";
import { cameraSawKnownPlate, vehicleTick } from "./vehicles.js";
import { detectPersons, groupCrop } from "../person-crop.js";
import { newVisionUpkeep, onVisionError, unverifiedText, visionUpkeepStep } from "./vision-rules.js";
import { inspectionCounters, timingLine, type VisionCall } from "./vision-timing-rules.js";

const MODE = (process.env.HUB_AGENT_SENTINEL || "on").trim().toLowerCase();
const NIGHT = (process.env.HUB_AGENT_SENTINEL_NIGHT || "22-6").trim();
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
  "Verdächtig ist: Klettern, Hantieren an Tür/Fenster/Schloss, Vermummung, Wegtragen von Sachen, Verstecken. " +
  'Beschreibe jede Person kurz zur Wiedererkennung an anderen Kameras (Farbe und Art von Jacke/Oberteil, Hose, Kopfbedeckung, Tasche, Statur). ' +
  'Antworte nur mit JSON: {"personen": Zahl, "arbeitskleidung": true|false, "mitarbeiter": true|false, "verdaechtig": true|false, ' +
  '"kleidung": ["Person 1: …", "Person 2: …"], "was": "ein Satz auf Deutsch"}';

let seq = 0;
/** Sperrzeiten je Kamera, laufende und wartende Bewertungen, Zaehler der Stunde (planTick). */
const queue = newQueue(Date.now());

type Offer = (label: string, tool: string, args: Record<string, unknown>, desc: string) => TgButton;
let deps: { chatIds: () => string[]; offer: Offer; renew?: (buttons: TgButton[][]) => void } | null = null;

/** Raum(e) der Kamera geschlossen? null = keine Betriebszeit hinterlegt. */
function cameraClosed(cameraId: number): boolean | null {
  const rooms = roomsPayload().rooms.filter((r) => r.cameras.some((c) => c.id === cameraId) && r.operating);
  if (!rooms.length) return null;
  return rooms.every((r) => r.operating?.open === false);
}

async function snap(cameraId: number): Promise<Buffer> {
  return isDoorbird(cameraId) ? captureDoorbirdSnapshot(cameraId) : captureSnapshot(cameraId);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
 * Aufruf des Bildmodells fuer eine Bewertung, mit Zeitmessung: Dauer und
 * Zeitangaben von Ollama kommen in `calls`, auch wenn der Aufruf scheitert.
 */
async function timedVision(calls: VisionCall[], label: string, jpeg: Buffer, prompt: string): Promise<string> {
  const started = Date.now();
  try {
    const answer = await askVisionTimed(jpeg, prompt, true);
    calls.push({ label, wallMs: answer.timing.wallMs, timing: answer.timing, endedAt: Date.now() });
    return answer.text;
  } catch (e) {
    calls.push({ label, wallMs: Date.now() - started, timing: null, endedAt: Date.now() });
    throw e;
  }
}

/** Ein Ereignis bewerten. Das Ergebnis bestimmt die Sperrzeit der Kamera (cooldownFor). */
async function inspectCam(cam: NonNullable<ReturnType<typeof findCameraByRef>>, title: string, at: number, calls: VisionCall[]): Promise<InspectOutcome> {
  let first = await snap(cam.id);
  SENTINEL.inspections++;
  const isPerson = /^PERSON\b/.test(title);
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
    const boxes = isPerson ? await detectPersons(first) : null;
    const seen = boxes ? boxes.length : null;
    if (onVisionError({ isPerson, trackerCount: seen, hour: localHour(), nightWindow: NIGHT }) === "befund") return "fehler";
    unverified = true;
    verdict = { auffaellig: true, was: unverifiedText(isPerson, seen), dringlichkeit: "mittel" };
  }
  SENTINEL.lastAt = new Date().toISOString();
  SENTINEL.lastVerdict = `${cam.name}: ${unverified ? "ungeprüft" : verdict.auffaellig ? "auffällig" : "unauffällig"} – ${verdict.was}`;
  if (!unverified) improve("camera", verdict.auffaellig ? "sentinel_alert" : "sentinel_calm", { camera: cam.name, trigger: title });
  if (!verdict.auffaellig) {
    log(`Wächter: ${cam.name} (${title}) unauffällig: ${verdict.was}`);
    recordActivity({ kind: "watch", where: cam.name, text: `${cam.name}: unauffällig – ${verdict.was}`, jpeg: first });
    return "unauffaellig";
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
  // Ohne Bildmodell gibt es keine Nahaufnahme-Bewertung und keine
  // Kleidungs-Merkliste: Der ungepruefte Alarm geht mit dem Standbild hinaus.
  if (isPerson && !unverified) {
    // Ist ueberhaupt jemand im Bild? Der Tracker (YOLO) zaehlt Personen. Sieht
    // er auf zwei Bildern niemanden, war es eine Fehlausloesung oder die
    // Person ist schon weg – dann kein Alarm mit leerem Bild.
    let boxes = await detectPersons(first);
    if (boxes && boxes.length === 0) {
      await sleep(1_500);
      const again = await snap(cam.id).catch(() => null);
      const b2 = again ? await detectPersons(again) : null;
      if (again && b2?.length) {
        first = again;
        boxes = b2;
      } else if (b2 && b2.length === 0) {
        log(`Wächter: ${cam.name}: Tracker sieht keine Person (2 Bilder) – kein Alarm`);
        SENTINEL.lastVerdict = `${cam.name}: keine Person im Bild`;
        recordActivity({ kind: "watch", where: cam.name, text: `${cam.name}: Personen-Signal, aber niemand im Bild – kein Alarm` });
        improve("camera", "sentinel_person_empty", { camera: cam.name });
        return "tracker_leer";
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
    const decision = decidePerson({ face, staff, look, hour: localHour(), known: known.map(clearedTitle) });
    reason = decision.reason;
    log(
      `Wächter: ${cam.name} Person: ${decision.alarm ? "ALARM" : "kein Alarm"} – ${decision.reason}` +
        (look ? ` (${look.personen} Pers., Arbeitskleidung ${look.arbeitskleidung ? "ja" : "nein"}: ${look.was})` : "") +
        (resting ? ` [${resting} ${resting === 1 ? "Mitarbeiter-Eintrag zählt" : "Mitarbeiter-Einträge zählen"} im Nachtfenster nicht]` : "")
    );
    improve("camera", decision.alarm ? "sentinel_person_alarm" : "sentinel_person_staff", { camera: cam.name, reason });
    personKleidung = look?.kleidung ?? [];
    if (!decision.alarm) {
      // Fuer die anderen Kameras merken (Regeln in people-rules.ts):
      // wiedererkannte verlaengern, eine einzelne neue Person dazu.
      const matched = (look?.bekannt ?? []).map((b) => known[b - 1]).filter(Boolean);
      const label = face?.name ?? (staff?.length ? "Mitarbeiter" : matched[0]?.label ?? "unbedenklich");
      const kept = await rememberSeen({
        camera: cam.name,
        basis: decision.basis,
        faceName: face?.name ?? null,
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
    if (look?.was) verdict = { ...verdict, was: look.was };
    // Gemeldete Personen 20 Minuten merken: dieselbe Person an der naechsten
    // Kamera loest keinen neuen Alarm aus (ausser sie verhaelt sich verdaechtig).
    // Die Frist laeuft ab dem Alarm und wird beim Wiedersehen nicht laenger.
    if (look?.kleidung.length && look.unbekannt > 0) await rememberReported(cam.name, look.kleidung);
  }

  SENTINEL.alerts++;
  log(`Wächter: ${cam.name} AUFFÄLLIG (${unverified ? "ungeprüft" : verdict.dringlichkeit}): ${verdict.was}`);
  if (unverified) improve("camera", "sentinel_unverified", { camera: cam.name, trigger: title });
  recordHubEvent({ kind: "camera", severity: "alert", where: cam.name, title: "Assistent: auffällig", detail: verdict.was });
  const followed = cameraFollowing(cam.id);

  const buttons: TgButton[][] = [];
  const row: TgButton[] = [];
  if (deps) {
    row.push(deps.offer("Neues Bild", "camera_snapshot", { camera: String(cam.id) }, `Neues Bild ${cam.name}`));
    if (caps?.spotlight) row.push(deps.offer("Licht an", "camera_control", { camera: String(cam.id), what: "spotlight", on: true }, `${cam.name}: Licht an`));
    if (caps?.siren) row.push(deps.offer("Sirene", "camera_control", { camera: String(cam.id), what: "siren", on: true }, `${cam.name}: Sirene an`));
  }
  if (row.length) buttons.push(row);
  const okData = personKleidung.length ? await offerPersonOk(cam.name, personKleidung) : null;
  if (okData) buttons.push([{ text: "Ist in Ordnung", callback_data: okData }]);

  const icon = verdict.dringlichkeit === "hoch" ? "‼️" : "⚠️";
  const time = new Date().toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
  const caption =
    `${icon} ${cam.name}, ${time}: ${verdict.was}` +
    (reason ? `\n${reason}.` : "") +
    (followed ? "\nKamera folgt der Person." : "");
  // Alarm und Zusatzbilder gehen in die Sende-Warteschlange (dispatch.ts): je
  // Chat in dieser Reihenfolge, mit Wiederholung, wenn Telegram nicht
  // erreichbar ist. Die Bewertung wartet nicht auf die Zustellung.
  const ids = deps?.chatIds() ?? [];
  const renew = deps?.renew;
  sendAlarm({
    chatIds: ids,
    camera: cam.name,
    jpeg: close ?? first,
    caption,
    buttons: buttons.length ? buttons : undefined,
    // Die Knoepfe gelten ab der Zustellung, nicht ab der Bewertung.
    onDelivered: renew && buttons.length ? () => renew(buttons) : undefined,
  });
  if (close) sendAlarmImage({ chatIds: ids, jpeg: first, caption: `${cam.name} · Übersicht` });

  // Bildserie: zwei weitere Bilder, damit der Verlauf zu sehen ist.
  for (let i = 1; i <= 2; i++) {
    await sleep(4_000);
    try {
      const jpeg = await snap(cam.id);
      // Bei Personen nur Bilder schicken, auf denen der Tracker noch jemanden sieht.
      if (isPerson && (await detectPersons(jpeg))?.length === 0) continue;
      sendAlarmImage({ chatIds: ids, jpeg, caption: `${cam.name} · +${i * 4} s` });
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
  const { where, title, seenAt } = started.trigger;
  void inspect(where, title, seenAt)
    .catch((e): InspectOutcome => {
      log(`Wächter: ${where}: ${e instanceof Error ? e.message : e}`);
      return "fehler";
    })
    .then((outcome) => {
      finishInspection(queue, started, outcome, localHour(), NIGHT);
      improveCount("camera", `sentinel_result_${outcome}`);
    })
    .catch((e) => log(`Wächter: ${e instanceof Error ? e.message : e}`));
}

async function tick(): Promise<void> {
  const events = hubEventsSince(seq);
  seq = currentEventSeq();
  notePersonEvents(events);
  if (deps) await vehicleTick(events, deps.chatIds()).catch((e) => log(`Assistent: Kennzeichen: ${e instanceof Error ? e.message : e}`));
  const now = Date.now();
  // Hoechstens eine Bilanz-Zeile je Stunde, nur fuer Stunden mit mindestens einem Ausloeser.
  for (const done of dueTallies(queue, now)) {
    const line = tallyLine(done, localHour(new Date(done.start)));
    if (line) log(line);
  }
  visionUpkeep(now);
  // Ohne bereites Bildmodell wird nichts bewertet; der Zustands-Waechter meldet den Ausfall (watch.ts).
  if (!SENTINEL.enabled || !VISION.ready) return;
  const plan = planTick(queue, {
    now,
    hour: localHour(),
    nightWindow: NIGHT,
    always: MODE === "always",
    maxPerHour: MAX_PER_HOUR,
    maxBusy: MAX_BUSY,
    events: events.flatMap((ev) => {
      const cam = ev.where && isTriggerEvent(ev) ? findCameraByRef(ev.where) : null;
      return cam && ev.where ? [{ ev, camId: cam.id, where: ev.where, closed: cameraClosed(cam.id) }] : [];
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

export function startSentinel(d: { chatIds: () => string[]; offer: Offer; renew?: (buttons: TgButton[][]) => void }): void {
  deps = d;
  seq = currentEventSeq();
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
