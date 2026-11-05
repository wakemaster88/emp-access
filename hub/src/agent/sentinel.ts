/**
 * Waechter mit Augen: Kamera-Ereignisse ausserhalb des Betriebs selbst
 * ansehen (Bildmodell), bei Auffaelligem die Kamera mitfuehren und Aaron mit
 * Bildern benachrichtigen.
 *
 * Ohne Rueckfrage (harmlos, stellt sich selbst zurueck):
 *  - PTZ-Kamera folgt dem Objekt fuer 3 Minuten (cameraScene, autoTrack),
 *    danach zurueck wie vorher.
 *  - Bildserie: drei Standbilder im Abstand von 4 s.
 * Personen: heranzoomen (Zoom-Objektiv, PTZ folgt), Nahaufnahme bewerten und
 * mit eingestempelten Mitarbeitern (emp-control) und der bestehenden
 * Gesichtserkennung abgleichen; vermutlich Mitarbeiter → kein Alarm
 * (Regeln in sentinel-rules.ts, decidePerson).
 * Mit Knopf in Telegram (Aaron entscheidet): Scheinwerfer, Sirene, neues Bild.
 * Nie automatisch: Tor oeffnen, Sirene, Licht, Netzwerk.
 */
import { log } from "../config.js";
import { currentEventSeq, hubEventsSince, recordHubEvent } from "../state.js";
import { captureSnapshot, findCameraByRef, getCameraCaps, cameraScene, cameraZoom, type CameraCaps } from "../cameras.js";
import { captureDoorbirdSnapshot, isDoorbird } from "../doorbird.js";
import { roomsPayload } from "../rooms.js";
import { improve } from "../improve-log.js";
import { VISION, askVision } from "./ollama.js";
import { sendPhoto } from "./telegram.js";
import type { TgButton } from "./telegram.js";
import { berlinHour } from "./watch.js";
import { decidePerson, parsePersonLook, parseVerdict, shouldInspect, type PersonLook, type Verdict } from "./sentinel-rules.js";
import { activeCleared, clearedTitle, faceAt, knownPrompt, notePersonEvents, offerPersonOk, rememberPeople, staffClockedIn } from "./people.js";
import { cameraSawKnownPlate, vehicleTick } from "./vehicles.js";

const MODE = (process.env.HUB_AGENT_SENTINEL || "on").trim().toLowerCase();
const NIGHT = (process.env.HUB_AGENT_SENTINEL_NIGHT || "22-6").trim();
const COOLDOWN_MS = 3 * 60_000;
const MAX_PER_HOUR = Number(process.env.HUB_AGENT_SENTINEL_MAX_PER_HOUR) > 0 ? Number(process.env.HUB_AGENT_SENTINEL_MAX_PER_HOUR) : 30;
const FOLLOW_SECONDS = 180;

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
const lastInspect = new Map<string, number>();
const recent: number[] = [];
let busy = 0;

type Offer = (label: string, tool: string, args: Record<string, unknown>, desc: string) => TgButton;
let deps: { chatIds: () => string[]; offer: Offer } | null = null;

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

/**
 * Heranzoomen fuer ein Detailbild: Zoom-Objektiv auf ~60 % fahren, Bild,
 * zurueck auf die vorige Position. Ohne Zoom: null (dann zaehlt das Weitbild).
 */
async function closeUp(cameraId: number, caps: CameraCaps | null): Promise<Buffer | null> {
  if (!caps?.zoom) return null;
  const cur = await cameraZoom(cameraId, null);
  const target = Math.round(cur.min + (cur.max - cur.min) * 0.6);
  if (target <= cur.pos) return snap(cameraId);
  try {
    await cameraZoom(cameraId, { pos: target });
    await sleep(3_000); // Fokus nachziehen lassen
    return await snap(cameraId);
  } finally {
    await cameraZoom(cameraId, { pos: cur.pos }).catch(() => undefined);
  }
}

async function inspect(where: string, title: string, at: number): Promise<void> {
  const cam = findCameraByRef(where);
  if (!cam) return;
  const first = await snap(cam.id);
  SENTINEL.inspections++;
  let verdict: Verdict;
  try {
    verdict = parseVerdict(await askVision(first, PROMPT, true));
  } catch (e) {
    log(`Wächter: ${cam.name}: Bildmodell: ${e instanceof Error ? e.message : e}`);
    return;
  }
  SENTINEL.lastAt = new Date().toISOString();
  SENTINEL.lastVerdict = `${cam.name}: ${verdict.auffaellig ? "auffällig" : "unauffällig"} – ${verdict.was}`;
  improve("camera", verdict.auffaellig ? "sentinel_alert" : "sentinel_calm", { camera: cam.name, trigger: title });
  if (!verdict.auffaellig) {
    log(`Wächter: ${cam.name} (${title}) unauffällig: ${verdict.was}`);
    return;
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
      return;
    }
  }
  // Automatisch: PTZ folgen lassen (stellt sich nach 3 min selbst zurueck).
  const caps = isDoorbird(cam.id) ? null : await getCameraCaps(cam.id).catch(() => null);
  let followed = false;
  const follow = async () => {
    if (!caps?.pan || followed) return;
    try {
      await cameraScene(cam.id, { autoTrack: true, returnAfterSeconds: FOLLOW_SECONDS });
      followed = true;
    } catch (e) {
      log(`Wächter: ${cam.name}: Folgen fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    }
  };

  // Person: heranzoomen, genauer ansehen, mit Stempeldaten/Gesicht abgleichen.
  let close: Buffer | null = null;
  let reason = "";
  let personKleidung: string[] = [];
  if (/^PERSON\b/.test(title)) {
    await follow();
    if (followed) await sleep(2_500); // Kamera richtet sich auf die Person aus
    close = await closeUp(cam.id, caps).catch((e) => {
      log(`Wächter: ${cam.name}: Heranzoomen fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
      return null;
    });
    const known = await activeCleared();
    let look: PersonLook | null = null;
    try {
      look = parsePersonLook(await askVision(close ?? first, PERSON_PROMPT + knownPrompt(known), true));
    } catch (e) {
      log(`Wächter: ${cam.name}: Nahaufnahme: ${e instanceof Error ? e.message : e}`);
    }
    let face = faceAt(cam.name, at);
    for (let i = 0; i < 3 && !face && Date.now() - at < 12_000; i++) {
      await sleep(2_000);
      face = faceAt(cam.name, at);
    }
    const staff = await staffClockedIn();
    const decision = decidePerson({ face, staff, look, hour: berlinHour(), known: known.map(clearedTitle) });
    reason = decision.reason;
    log(
      `Wächter: ${cam.name} Person: ${decision.alarm ? "ALARM" : "kein Alarm"} – ${decision.reason}` +
        (look ? ` (${look.personen} Pers., Arbeitskleidung ${look.arbeitskleidung ? "ja" : "nein"}: ${look.was})` : "")
    );
    improve("camera", decision.alarm ? "sentinel_person_alarm" : "sentinel_person_staff", { camera: cam.name, reason });
    personKleidung = look?.kleidung ?? [];
    if (!decision.alarm) {
      // Fuer die anderen Kameras merken: wiedererkannte verlaengern, neue dazu.
      const matched = (look?.bekannt ?? []).map((b) => known[b - 1]).filter(Boolean);
      const label = face?.name ?? (staff?.length ? "Mitarbeiter" : matched[0]?.label ?? "unbedenklich");
      await rememberPeople({ camera: cam.name, kleidung: look && look.unbekannt > 0 ? look.kleidung : [], label, matched });
      SENTINEL.lastVerdict = `${cam.name}: vermutlich Mitarbeiter – ${decision.reason}`;
      recordHubEvent({ kind: "camera", severity: "info", where: cam.name, title: "Assistent: vermutlich Mitarbeiter", detail: decision.reason });
      return;
    }
    if (look?.was) verdict = { ...verdict, was: look.was };
  }

  SENTINEL.alerts++;
  log(`Wächter: ${cam.name} AUFFÄLLIG (${verdict.dringlichkeit}): ${verdict.was}`);
  recordHubEvent({ kind: "camera", severity: "alert", where: cam.name, title: "Assistent: auffällig", detail: verdict.was });
  await follow();

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
    (followed ? `\nKamera folgt ${FOLLOW_SECONDS / 60} Minuten.` : "");
  const ids = deps?.chatIds() ?? [];
  for (const id of ids) await sendPhoto(id, close ?? first, caption, buttons.length ? buttons : undefined).catch(() => undefined);
  if (close) for (const id of ids) await sendPhoto(id, first, `${cam.name} · Übersicht`).catch(() => undefined);

  // Bildserie: zwei weitere Bilder, damit der Verlauf zu sehen ist.
  for (let i = 1; i <= 2; i++) {
    await sleep(4_000);
    try {
      const jpeg = await snap(cam.id);
      for (const id of ids) await sendPhoto(id, jpeg, `${cam.name} · +${i * 4} s`).catch(() => undefined);
    } catch {
      break;
    }
  }
}

async function tick(): Promise<void> {
  const events = hubEventsSince(seq);
  seq = currentEventSeq();
  notePersonEvents(events);
  if (deps) await vehicleTick(events, deps.chatIds()).catch((e) => log(`Assistent: Kennzeichen: ${e instanceof Error ? e.message : e}`));
  if (!SENTINEL.enabled || !VISION.ready) return;
  const now = Date.now();
  while (recent.length && now - recent[0] > 3_600_000) recent.shift();
  for (const ev of events) {
    if (!ev.where) continue;
    const cam = findCameraByRef(ev.where);
    if (!cam) continue;
    const ok = shouldInspect(ev, {
      closed: cameraClosed(cam.id),
      hour: berlinHour(),
      nightWindow: NIGHT,
      always: MODE === "always",
      lastInspectAt: lastInspect.get(ev.where),
      now,
      cooldownMs: COOLDOWN_MS,
      inspectionsLastHour: recent.length,
      maxPerHour: MAX_PER_HOUR,
    });
    if (!ok || busy >= 2) continue;
    lastInspect.set(ev.where, now);
    recent.push(now);
    busy++;
    void inspect(ev.where, ev.title, now)
      .catch((e) => log(`Wächter: ${ev.where}: ${e instanceof Error ? e.message : e}`))
      .finally(() => busy--);
  }
}

export function startSentinel(d: { chatIds: () => string[]; offer: Offer }): void {
  deps = d;
  seq = currentEventSeq();
  if (!SENTINEL.enabled) log("Wächter mit Bildern: aus (HUB_AGENT_SENTINEL=off)");
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void tick()
      .catch((e) => log(`Wächter: ${e instanceof Error ? e.message : e}`))
      .finally(() => (running = false));
  }, 3_000);
}
