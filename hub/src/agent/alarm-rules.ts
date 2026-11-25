/**
 * Alarm-Nachricht des Waechters: wie dringend sie ist, wie ihr Kopf lautet
 * und was ihre Knoepfe duerfen. Reine Logik, ohne Netz und ohne Uhr.
 *
 * Dringend („hoch“, deutlich markiert) ist ein Alarm im Nachtfenster, bei
 * einer gesperrten Person und bei einer harten Handlung (Klettern, Hantieren
 * an Tuer, Fenster oder Schloss, Verstecken, eine Antwort im alten Format
 * oder ein Wert, der sich nicht zuordnen laesst; HARD_ACTIONS). Am Tag
 * bleibt es sonst beim Urteil des Bildmodells: „hoch“ zeigt ‼️, alles
 * andere ⚠️.
 */
import { inQuietHours } from "./quiet.js";
import { ACTION_TEXT, HARD_ACTIONS, type AlarmBasis, type Handlung, type Verdict } from "./sentinel-rules.js";
import type { TgButton } from "./telegram.js";

export interface AlarmLevelInput {
  /** Ortszeit-Stunde; NaN = nicht lesbar. */
  hour: number;
  nightWindow: string;
  /** Kurzform des Grunds aus decidePerson; null = ohne Personen-Entscheidung (Fahrzeug, ungeprueft). */
  reason: AlarmBasis | null;
  /** Handlung laut Nahaufnahme; null = keine Nahaufnahme. */
  handlung: Handlung | null;
  /** Liste des Gesichts-Treffers (WHITELIST | BLACKLIST); null = kein Treffer. */
  list: string | null;
  /** Dringlichkeit laut erstem Blick des Bildmodells. */
  dringlichkeit: Verdict["dringlichkeit"];
}

export interface AlarmLevel {
  level: "hoch" | "normal";
  /**
   * Warum die Regel den Alarm als dringend markiert, z. B. „nachts“. Leer,
   * wenn keine Regel greift; dann zaehlt allein das Bildmodell.
   */
  marks: string[];
}

/**
 * Dringlichkeit eines Alarms. Ist die Stunde nicht lesbar, laesst sich das
 * Nachtfenster nicht ausschliessen: Der Alarm gilt dann als dringend.
 */
export function alarmLevel(a: AlarmLevelInput): AlarmLevel {
  const marks: string[] = [];
  if (!Number.isFinite(a.hour)) marks.push("Uhrzeit nicht lesbar");
  else if (inQuietHours(a.nightWindow, a.hour)) marks.push("nachts");
  if (a.list === "BLACKLIST" || a.reason === "gesperrt") marks.push("gesperrte Person");
  if (a.handlung && HARD_ACTIONS.has(a.handlung)) marks.push(ACTION_TEXT[a.handlung]);
  else if (a.reason === "verdaechtig") marks.push(ACTION_TEXT.verdaechtig);
  return { level: marks.length > 0 || a.dringlichkeit === "hoch" ? "hoch" : "normal", marks };
}

/**
 * Erste Zeile der Alarm-Nachricht bis zum Doppelpunkt: Zeichen, bei einer
 * Regel „DRINGEND“ mit ihrem Grund, Kamera und Uhrzeit. Telegram zeigt sie in
 * der Benachrichtigung zuerst.
 */
export function alarmHead(l: AlarmLevel, camera: string, time: string): string {
  if (l.marks.length) return `‼️ DRINGEND (${l.marks.join(", ")}) · ${camera}, ${time}`;
  return `${l.level === "hoch" ? "‼️" : "⚠️"} ${camera}, ${time}`;
}

/* ------------------------------------------------------------ Knoepfe */

/*
 * Die Knoepfe eines Alarms tragen alles, was ein Tipp braucht, in ihren
 * Daten: Kamera, Aktion und, wo eine Frist gilt, die Sekunde, in der die
 * Nachricht hinausging. Der Hub muss sich dafuer nichts merken; die Knoepfe
 * gelten auch nach einem Neustart. Wer tippen darf (gekoppelter Chat), prueft
 * agent.ts wie bei jedem anderen Knopf. Licht und Sirene schalten je Alarm
 * einmal (buttonRepeated); dafuer merkt sich der Hub im Speicher, wann er sie
 * zuletzt per Knopf geschaltet hat.
 *
 *   cam:<id>:snap             Neues Bild, unbegrenzt
 *   cam:<id>:spot:<Sekunde>   Licht an, 60 Minuten
 *   cam:<id>:siren:<Sekunde>  Sirene, 10 Minuten
 *
 * <Sekunde> zaehlt ab 1970 (UTC), also ohne Zeitzone und Zeitumstellung.
 */

export type AlarmButton = "snap" | "spot" | "siren";

/** Frist je Knopf ab der Sekunde im Knopf; null = unbegrenzt. */
export const BUTTON_TTL_MS: Readonly<Record<AlarmButton, number | null>> = {
  snap: null,
  spot: 60 * 60_000,
  siren: 10 * 60_000,
};

/** Beschriftung je Knopf. */
export const BUTTON_TEXT: Readonly<Record<AlarmButton, string>> = { snap: "Neues Bild", spot: "Licht an", siren: "Sirene" };

/** Anfang der Knopf-Daten eines Alarms. */
export const BUTTON_PREFIX = "cam:";
/** Laenger darf callback_data bei Telegram nicht sein (Bytes). */
export const BUTTON_MAX_BYTES = 64;
/** So weit darf die Sekunde im Knopf vor der Uhr des Hubs liegen (Uhr nachgestellt). */
export const BUTTON_FUTURE_MS = 5 * 60_000;

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

/** Knopf-Daten fuer eine Kamera; `at` ist der Zeitpunkt, zu dem die Nachricht hinausgeht. */
export function buttonData(cameraId: number, button: AlarmButton, at: number): string {
  return BUTTON_TTL_MS[button] === null ? `${BUTTON_PREFIX}${cameraId}:${button}` : `${BUTTON_PREFIX}${cameraId}:${button}:${Math.floor(at / SECOND_MS)}`;
}

/**
 * Knopf-Reihe eines Alarms: Neues Bild immer, Licht und Sirene nur, wenn die
 * Kamera sie hat. `at` ist der Zeitpunkt des Sendeversuchs: Die Frist beginnt
 * mit der Nachricht, die ankommt, nicht mit der Bewertung davor.
 */
export function alarmButtonRow(cameraId: number, caps: { spotlight: boolean; siren: boolean }, at: number): TgButton[] {
  const buttons: AlarmButton[] = ["snap", ...(caps.spotlight ? (["spot"] as const) : []), ...(caps.siren ? (["siren"] as const) : [])];
  return buttons.map((b) => ({ text: BUTTON_TEXT[b], callback_data: buttonData(cameraId, b, at) }));
}

export type ButtonCheck =
  | {
      ok: true;
      camera: number;
      button: AlarmButton;
      /** Versand der Nachricht laut Knopf (ms, auf die Sekunde); null bei „Neues Bild“. */
      sentAt: number | null;
    }
  | {
      ok: false;
      /**
       * fremd: keine Knopf-Daten eines Alarms. verstuemmelt: Aufbau stimmt
       * nicht. kamera: die Kamera gibt es nicht mehr. abgelaufen: die Frist
       * des Knopfs ist vorbei.
       */
      why: "fremd" | "verstuemmelt" | "kamera" | "abgelaufen";
      camera?: number;
      button?: AlarmButton;
      /** Bei „abgelaufen“: so lange ist die Sekunde im Knopf her. */
      ageMs?: number;
    };

const BUTTON_RE = /^cam:([1-9]\d{0,8}):(snap|spot|siren)(?::(\d{1,12}))?$/;

/**
 * Darf ein Tipp auf einen Alarm-Knopf ausgefuehrt werden? `hasCamera` sagt,
 * ob es die Kamera noch gibt. Die Frist zaehlt ab der Sekunde im Knopf, also
 * ab dem Versand der Nachricht: Die Sirene gilt 10 Minuten, Licht an 60
 * Minuten, auf die Sekunde genau. Eine Sekunde mehr als BUTTON_FUTURE_MS in
 * der Zukunft passt zu keiner gesendeten Nachricht und gilt als verstuemmelt.
 */
export function buttonValid(data: string, now: number, hasCamera: (id: number) => boolean): ButtonCheck {
  if (typeof data !== "string" || !data.startsWith(BUTTON_PREFIX)) return { ok: false, why: "fremd" };
  const m = Buffer.byteLength(data, "utf8") <= BUTTON_MAX_BYTES ? BUTTON_RE.exec(data) : null;
  if (!m) return { ok: false, why: "verstuemmelt" };
  const camera = Number(m[1]);
  const button = m[2] as AlarmButton;
  const ttl = BUTTON_TTL_MS[button];
  // Mit Frist braucht der Knopf seine Sekunde, ohne Frist hat er keine.
  if ((ttl === null) !== (m[3] === undefined)) return { ok: false, why: "verstuemmelt", camera, button };
  if (!hasCamera(camera)) return { ok: false, why: "kamera", camera, button };
  if (ttl === null) return { ok: true, camera, button, sentAt: null };
  const start = Number(m[3]) * SECOND_MS;
  if (start > now + BUTTON_FUTURE_MS) return { ok: false, why: "verstuemmelt", camera, button };
  if (now >= start + ttl) return { ok: false, why: "abgelaufen", camera, button, ageMs: now - start };
  return { ok: true, camera, button, sentAt: start };
}

/**
 * Ist ein gueltiger Tipp eine Wiederholung, die nicht noch einmal schaltet?
 * `lastRun` ist, wann der Hub denselben Knopf derselben Kamera zuletzt
 * geschaltet hat (undefined = seit dem Start nicht). Schaltete er nach dem
 * Versand dieser Nachricht (`sentAt`), ist der Tipp schon ausgefuehrt: ein
 * Doppeltipp, ein zweiter Chat mit demselben Alarm oder ein spaeterer Tipp auf
 * dieselbe Nachricht. Ein Alarm, der erst danach hinausging, schaltet wieder.
 * „Neues Bild“ ist nie eine Wiederholung. Nach einem Neustart ist der Speicher
 * leer: Dann schaltet der erste Tipp, wie bei einem neuen Alarm. Liegt das
 * letzte Schalten nach `now` (die Uhr des Hubs wurde zurueckgestellt), ist
 * unklar, ob es diesem Alarm galt: Dann schaltet der Tipp (im Zweifel
 * ausfuehren).
 */
export function buttonRepeated(button: AlarmButton, sentAt: number | null, lastRun: number | undefined, now: number): boolean {
  if (BUTTON_TTL_MS[button] === null || sentAt === null || lastRun === undefined) return false;
  if (lastRun > now) return false;
  return lastRun >= sentAt;
}

/** So lange gilt das Schalten eines Tipps als laufend; danach verfaellt der Eintrag. */
export const BUTTON_RUNNING_MS = 2 * MINUTE_MS;
/** So viele Chats merkt sich ein laufendes Schalten hoechstens (fuer die Meldung, wenn es scheitert). */
export const BUTTON_RUNNING_CHATS = 20;

/** Ein laufendes Schalten von Licht oder Sirene: seit wann, und welche Chats getippt haben (der erste zuerst). */
export interface ButtonRunning {
  since: number;
  chats: string[];
}

/**
 * Laeuft dieses Schalten noch? Ein Eintrag verfaellt nach BUTTON_RUNNING_MS;
 * einer aus der Zukunft (Uhr zurueckgestellt) gilt nicht.
 */
export function buttonRunning(r: ButtonRunning | undefined, now: number): r is ButtonRunning {
  return r !== undefined && now >= r.since && now - r.since < BUTTON_RUNNING_MS;
}

/**
 * Antwort auf einen Tipp, der nicht noch einmal schaltet (buttonRepeated).
 * Laeuft das Schalten des ersten Tipps noch, heisst sie „Wird gerade
 * ausgeführt …“, und der Chat kommt in den Eintrag (hoechstens
 * BUTTON_RUNNING_CHATS): Scheitert das Schalten, erfaehrt er es. Sonst
 * „Schon ausgeführt.“, und `running` ist null.
 */
export function repeatReply(r: ButtonRunning | undefined, chatId: string, now: number): { text: string; running: ButtonRunning | null } {
  if (!buttonRunning(r, now)) return { text: "Schon ausgeführt.", running: null };
  const chats = r.chats.includes(chatId) || r.chats.length >= BUTTON_RUNNING_CHATS ? r.chats : [...r.chats, chatId];
  return { text: "Wird gerade ausgeführt …", running: { since: r.since, chats } };
}

/** Log-Zeile zu einem Tipp, der schon ausgefuehrt ist (ohne „Assistent: “); `agoMs` = seit dem letzten Schalten. */
export function buttonRepeatLine(camera: number, button: AlarmButton, agoMs: number): string {
  const s = Math.max(0, Math.round(agoMs / SECOND_MS));
  return `Knopf „${BUTTON_TEXT[button]}“ (Kamera ${camera}) nicht erneut ausgeführt: schon vor ${s} s geschaltet, nach dem Versand dieser Nachricht`;
}

/**
 * Was ein gueltiger Tipp ausfuehrt: dasselbe Werkzeug wie bisher, nur
 * einschalten, mit dem Text fuer Log und Antwort.
 */
export function buttonTool(camera: number, button: AlarmButton, cameraName: string): { tool: string; args: Record<string, unknown>; desc: string } {
  const ref = String(camera);
  if (button === "snap") return { tool: "camera_snapshot", args: { camera: ref }, desc: `Neues Bild ${cameraName}` };
  if (button === "spot") return { tool: "camera_control", args: { camera: ref, what: "spotlight", on: true }, desc: `${cameraName}: Licht an` };
  return { tool: "camera_control", args: { camera: ref, what: "siren", on: true }, desc: `${cameraName}: Sirene an` };
}

/** Log-Zeile zu einem Tipp, der nicht ausgefuehrt wird (ohne „Assistent: “). */
export function buttonRefusalLine(check: Extract<ButtonCheck, { ok: false }>, data: string): string {
  const name = check.button ? `„${BUTTON_TEXT[check.button]}“` : "";
  const cam = check.camera !== undefined ? ` (Kamera ${check.camera})` : "";
  switch (check.why) {
    case "abgelaufen": {
      const ttl = BUTTON_TTL_MS[check.button!]!;
      return `Knopf ${name}${cam} abgelaufen: gilt ${Math.round(ttl / MINUTE_MS)} min, die Nachricht ist ${Math.floor((check.ageMs ?? 0) / MINUTE_MS)} min alt`;
    }
    case "kamera":
      return `Knopf ${name}${cam} nicht ausgeführt: die Kamera gibt es nicht mehr`;
    default:
      return `Knopf mit unbekannten Daten abgelehnt: ${JSON.stringify(data.slice(0, BUTTON_MAX_BYTES))}`;
  }
}
