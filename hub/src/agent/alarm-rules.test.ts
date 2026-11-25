import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUTTON_MAX_BYTES,
  BUTTON_RUNNING_CHATS,
  BUTTON_RUNNING_MS,
  alarmButtonRow,
  alarmHead,
  alarmLevel,
  buttonData,
  buttonRefusalLine,
  buttonRepeatLine,
  buttonRepeated,
  buttonRunning,
  buttonTool,
  buttonValid,
  repeatReply,
  type AlarmLevelInput,
  type ButtonCheck,
} from "./alarm-rules.js";

const NIGHT = "22-6";

const input = (o: Partial<AlarmLevelInput> = {}): AlarmLevelInput => ({
  hour: 14,
  nightWindow: NIGHT,
  reason: "niemand",
  handlung: "keine",
  list: null,
  dringlichkeit: "niedrig",
  ...o,
});

test("alarmLevel: am Tag wie bisher, das Bildmodell entscheidet über ‼️", () => {
  assert.deepEqual(alarmLevel(input()), { level: "normal", marks: [] });
  assert.deepEqual(alarmLevel(input({ dringlichkeit: "mittel" })), { level: "normal", marks: [] });
  assert.deepEqual(alarmLevel(input({ dringlichkeit: "hoch" })), { level: "hoch", marks: [] });
  // Tragen oder Vermummung allein sind keine harte Handlung.
  assert.deepEqual(alarmLevel(input({ handlung: "traegt_etwas", reason: "ohne_freigabe" })), { level: "normal", marks: [] });
  assert.deepEqual(alarmLevel(input({ handlung: "vermummt", reason: "ohne_freigabe" })), { level: "normal", marks: [] });
  // Whitelist-Treffer ohne Entwarnung ist kein Grund.
  assert.deepEqual(alarmLevel(input({ list: "WHITELIST" })), { level: "normal", marks: [] });
});

test("alarmLevel: im Nachtfenster immer dringend, auch bei „niedrig“", () => {
  for (const hour of [22, 23, 0, 3, 5]) assert.deepEqual(alarmLevel(input({ hour })), { level: "hoch", marks: ["nachts"] }, `Stunde ${hour}`);
  for (const hour of [6, 7, 12, 21]) assert.equal(alarmLevel(input({ hour })).level, "normal", `Stunde ${hour}`);
});

test("alarmLevel: Fahrzeug und ungeprüfter Alarm (ohne Personen-Entscheidung) zählen im Nachtfenster als dringend", () => {
  const ohne = { reason: null, handlung: null, list: null } as const;
  assert.deepEqual(alarmLevel(input({ ...ohne, hour: 23, dringlichkeit: "mittel" })), { level: "hoch", marks: ["nachts"] });
  assert.deepEqual(alarmLevel(input({ ...ohne, hour: 14, dringlichkeit: "mittel" })), { level: "normal", marks: [] });
});

test("alarmLevel: gesperrte Person ist dringend, zu jeder Stunde", () => {
  assert.deepEqual(alarmLevel(input({ reason: "gesperrt", list: "BLACKLIST" })), { level: "hoch", marks: ["gesperrte Person"] });
  assert.deepEqual(alarmLevel(input({ reason: null, list: "BLACKLIST" })), { level: "hoch", marks: ["gesperrte Person"] });
  assert.deepEqual(alarmLevel(input({ hour: 23, reason: "gesperrt", list: "BLACKLIST" })), {
    level: "hoch",
    marks: ["nachts", "gesperrte Person"],
  });
});

test("alarmLevel: harte Handlung ist dringend, mit ihrem Kurztext", () => {
  assert.deepEqual(alarmLevel(input({ reason: "verdaechtig", handlung: "klettern" })), { level: "hoch", marks: ["klettert"] });
  assert.deepEqual(alarmLevel(input({ reason: "verdaechtig", handlung: "tuer_fenster_schloss" })), {
    level: "hoch",
    marks: ["hantiert an Tür, Fenster oder Schloss"],
  });
  assert.deepEqual(alarmLevel(input({ reason: "verdaechtig", handlung: "versteckt" })), { level: "hoch", marks: ["versteckt sich"] });
  // Altes Antwortformat und nicht zuzuordnender Wert zählen wie in decidePerson als hart.
  assert.deepEqual(alarmLevel(input({ reason: "verdaechtig", handlung: "verdaechtig" })), { level: "hoch", marks: ["Verhalten wirkt verdächtig"] });
  assert.deepEqual(alarmLevel(input({ reason: "verdaechtig", handlung: "unklar" })), { level: "hoch", marks: ["Handlung nicht eindeutig"] });
  // Grund „verdaechtig“ ohne Handlung (fehlende Nahaufnahme): trotzdem dringend.
  assert.deepEqual(alarmLevel(input({ reason: "verdaechtig", handlung: null })), { level: "hoch", marks: ["Verhalten wirkt verdächtig"] });
});

test("alarmLevel: Stunde nicht lesbar heißt dringend", () => {
  assert.deepEqual(alarmLevel(input({ hour: NaN })), { level: "hoch", marks: ["Uhrzeit nicht lesbar"] });
});

test("alarmLevel: ohne Nachtfenster entscheidet die Uhrzeit nicht", () => {
  assert.deepEqual(alarmLevel(input({ hour: 23, nightWindow: "" })), { level: "normal", marks: [] });
});

test("alarmHead: DRINGEND mit Grund, sonst Zeichen wie bisher", () => {
  assert.equal(alarmHead({ level: "hoch", marks: ["nachts"] }, "Eingang", "23:04"), "‼️ DRINGEND (nachts) · Eingang, 23:04");
  assert.equal(
    alarmHead({ level: "hoch", marks: ["nachts", "klettert"] }, "Eingang", "23:04"),
    "‼️ DRINGEND (nachts, klettert) · Eingang, 23:04"
  );
  assert.equal(alarmHead({ level: "hoch", marks: [] }, "Eingang", "14:10"), "‼️ Eingang, 14:10");
  assert.equal(alarmHead({ level: "normal", marks: [] }, "Eingang", "14:10"), "⚠️ Eingang, 14:10");
});

/* ------------------------------------------------------------ Knöpfe */

const MIN = 60_000;
const SEC = 1_000;
/** Ein Zeitpunkt am Anfang einer Minute (25.11.2026, 23:04 UTC). */
const T = Date.UTC(2026, 10, 25, 23, 4, 0);
const known = (...ids: number[]) => (id: number) => ids.includes(id);
const cams = known(3, 9);

test("buttonData: Kamera, Aktion und Sekunde; Neues Bild ohne Sekunde; nie länger als 64 Bytes", () => {
  assert.equal(buttonData(9, "snap", T + 30_000), "cam:9:snap");
  assert.equal(buttonData(9, "spot", T + 30_000), `cam:9:spot:${T / SEC + 30}`);
  assert.equal(buttonData(9, "siren", T + 59_999), `cam:9:siren:${T / SEC + 59}`);
  const longest = buttonData(999_999_999, "siren", Date.UTC(9999, 11, 31));
  assert.ok(Buffer.byteLength(longest) <= BUTTON_MAX_BYTES, longest);
  assert.deepEqual(buttonValid(longest, Date.UTC(9999, 11, 31), known(999_999_999)), {
    ok: true,
    camera: 999_999_999,
    button: "siren",
    sentAt: Math.floor(Date.UTC(9999, 11, 31) / SEC) * SEC,
  });
});

test("alarmButtonRow: Neues Bild immer, Licht und Sirene nur, wenn die Kamera sie hat", () => {
  const texts = (caps: { spotlight: boolean; siren: boolean }) => alarmButtonRow(3, caps, T).map((b) => `${b.text}=${b.callback_data}`);
  assert.deepEqual(texts({ spotlight: false, siren: false }), ["Neues Bild=cam:3:snap"]);
  assert.deepEqual(texts({ spotlight: true, siren: true }), ["Neues Bild=cam:3:snap", `Licht an=cam:3:spot:${T / SEC}`, `Sirene=cam:3:siren:${T / SEC}`]);
  assert.deepEqual(texts({ spotlight: false, siren: true }), ["Neues Bild=cam:3:snap", `Sirene=cam:3:siren:${T / SEC}`]);
});

test("buttonValid: Neues Bild gilt unbegrenzt, auch nach einem Neustart", () => {
  const data = buttonData(9, "snap", T);
  assert.deepEqual(buttonValid(data, T, cams), { ok: true, camera: 9, button: "snap", sentAt: null });
  assert.deepEqual(buttonValid(data, T + 400 * 24 * 60 * MIN, cams), { ok: true, camera: 9, button: "snap", sentAt: null });
});

test("buttonValid: Licht an gilt 60 Minuten, Sirene 10 Minuten ab dem Versand der Nachricht", () => {
  // Gesendet 23:04:50, spät in der Minute: Die Frist zählt ab 23:04:50, nicht ab dem Ende der Minute.
  const sent = T + 50 * SEC;
  const spot = buttonData(9, "spot", sent);
  assert.deepEqual(buttonValid(spot, sent, cams), { ok: true, camera: 9, button: "spot", sentAt: sent });
  assert.equal(buttonValid(spot, sent + 60 * MIN - 1, cams).ok, true);
  assert.deepEqual(buttonValid(spot, sent + 60 * MIN, cams), { ok: false, why: "abgelaufen", camera: 9, button: "spot", ageMs: 60 * MIN });
  assert.equal(buttonValid(spot, sent + 60 * MIN + SEC, cams).ok, false);

  const siren = buttonData(3, "siren", sent);
  assert.equal(buttonValid(siren, sent + 10 * MIN - 1, cams).ok, true);
  assert.deepEqual(buttonValid(siren, sent + 10 * MIN, cams), { ok: false, why: "abgelaufen", camera: 3, button: "siren", ageMs: 10 * MIN });
  assert.deepEqual(buttonValid(siren, sent + 10 * MIN + SEC, cams), { ok: false, why: "abgelaufen", camera: 3, button: "siren", ageMs: 10 * MIN + SEC });
  assert.equal(buttonValid(siren, sent + 3 * 60 * MIN, cams).ok, false);

  // Bruchteile der Sekunde zählen nicht mit: Gesendet um 23:04:50,900, gilt die Sirene bis 23:14:50.
  const late = buttonData(3, "siren", sent + 900);
  assert.equal(late, siren);
  assert.equal(buttonValid(late, sent + 10 * MIN - 1, cams).ok, true);
  assert.equal(buttonValid(late, sent + 10 * MIN, cams).ok, false);
});

test("buttonRepeated: Licht und Sirene schalten je Alarm einmal, Neues Bild immer", () => {
  const sent = T + 50 * SEC;
  const now = sent + 45 * MIN;
  // Seit dem Start nicht geschaltet: Der erste Tipp schaltet, auch nach einem Neustart.
  assert.equal(buttonRepeated("siren", sent, undefined, now), false);
  // Doppeltipp oder zweiter Chat: geschaltet nach dem Versand dieser Nachricht.
  assert.equal(buttonRepeated("siren", sent, sent + 40 * SEC, now), true);
  assert.equal(buttonRepeated("siren", sent, sent, now), true);
  assert.equal(buttonRepeated("spot", sent, sent + 30 * MIN, now), true);
  // Im zweiten Chat ging dieselbe Meldung zwei Sekunden später hinaus, getippt wurde erst danach.
  assert.equal(buttonRepeated("siren", sent + 2 * SEC, sent + 40 * SEC, now), true);
  // Ein Alarm, der erst nach dem Schalten hinausging, schaltet wieder.
  assert.equal(buttonRepeated("siren", sent + 4 * MIN, sent + 40 * SEC, now), false);
  // Licht und Sirene zählen getrennt (der Hub merkt sie je Kamera und Knopf).
  assert.equal(buttonRepeated("spot", sent, undefined, now), false);
  // Neues Bild ist wiederholbar.
  assert.equal(buttonRepeated("snap", null, sent + 40 * SEC, now), false);
  assert.equal(buttonRepeated("snap", null, undefined, now), false);
});

test("buttonRepeated: Uhr zurückgestellt, das letzte Schalten liegt in der Zukunft und zählt nicht", () => {
  const sent = T + 50 * SEC;
  const lastRun = sent + 40 * SEC;
  // Genau jetzt geschaltet (Doppeltipp in derselben Millisekunde): Wiederholung.
  assert.equal(buttonRepeated("siren", sent, lastRun, lastRun), true);
  // Die Uhr ging eine Sekunde zurück: Der Tipp schaltet.
  assert.equal(buttonRepeated("siren", sent, lastRun, lastRun - 1), false);
  assert.equal(buttonRepeated("spot", sent, lastRun, sent), false);
});

test("repeatReply: zweiter Tipp während das Schalten läuft, „Wird gerade ausgeführt …“ und der Chat wird gemerkt", () => {
  const since = T + 60 * SEC;
  const first = { since, chats: ["A"] };
  // Der zweite Chat tippt zwei Sekunden nach dem ersten.
  const r = repeatReply(first, "B", since + 2 * SEC);
  assert.deepEqual(r, { text: "Wird gerade ausgeführt …", running: { since, chats: ["A", "B"] } });
  // Derselbe Chat noch einmal (Doppeltipp): nicht doppelt gemerkt.
  assert.deepEqual(repeatReply(r.running!, "B", since + 3 * SEC).running, { since, chats: ["A", "B"] });
  assert.deepEqual(repeatReply(r.running!, "A", since + 3 * SEC).running, { since, chats: ["A", "B"] });
  // Ohne laufendes Schalten: wie bisher.
  assert.deepEqual(repeatReply(undefined, "B", since), { text: "Schon ausgeführt.", running: null });
  // Der Eintrag verfällt nach BUTTON_RUNNING_MS.
  assert.equal(repeatReply(first, "B", since + BUTTON_RUNNING_MS - 1).running !== null, true);
  assert.deepEqual(repeatReply(first, "B", since + BUTTON_RUNNING_MS), { text: "Schon ausgeführt.", running: null });
  // Aus der Zukunft (Uhr zurückgestellt): gilt nicht.
  assert.equal(buttonRunning(first, since - 1), false);
  assert.equal(buttonRunning(first, since), true);
  assert.equal(buttonRunning(undefined, since), false);
});

test("repeatReply: höchstens BUTTON_RUNNING_CHATS Chats je Schalten", () => {
  const since = T;
  const full = { since, chats: Array.from({ length: BUTTON_RUNNING_CHATS }, (_, i) => `C${i}`) };
  const r = repeatReply(full, "neu", since + SEC);
  assert.equal(r.text, "Wird gerade ausgeführt …");
  assert.equal(r.running?.chats.length, BUTTON_RUNNING_CHATS);
  assert.equal(r.running?.chats.includes("neu"), false);
});

test("buttonRepeatLine: Log-Zeile zum zweiten Tipp", () => {
  assert.equal(
    buttonRepeatLine(9, "siren", 12_400),
    "Knopf „Sirene“ (Kamera 9) nicht erneut ausgeführt: schon vor 12 s geschaltet, nach dem Versand dieser Nachricht"
  );
  assert.equal(buttonRepeatLine(3, "spot", -5), "Knopf „Licht an“ (Kamera 3) nicht erneut ausgeführt: schon vor 0 s geschaltet, nach dem Versand dieser Nachricht");
});

test("buttonValid: fremde Knopf-Daten gehören nicht hierher", () => {
  for (const data of ["ok:0123456789ab", "no:0123456789ab", "pok:0123abcd", "vokGTAB4321", "", "CAM:9:snap", " cam:9:snap"]) {
    assert.deepEqual(buttonValid(data, T, cams), { ok: false, why: "fremd" }, data);
  }
});

test("buttonValid: verstümmelte Daten werden abgelehnt", () => {
  const bad = [
    "cam:",
    "cam:9",
    "cam:9:",
    "cam:x:snap",
    "cam:0:snap",
    "cam:09:snap",
    "cam:-1:snap",
    "cam:9:boom",
    "cam:9:snap:" + T / SEC,
    "cam:9:spot",
    "cam:9:siren:",
    "cam:9:siren:-5",
    "cam:9:siren:12.5",
    "cam:9:spot:" + T / SEC + ":1",
    "cam:9:spot:" + T / SEC + " ",
    "cam:9:snap\n",
    "cam:9:siren:" + "9".repeat(60),
  ];
  for (const data of bad) assert.equal((buttonValid(data, T, cams) as Extract<ButtonCheck, { ok: false }>).why, "verstuemmelt", JSON.stringify(data));
  // Eine Sekunde weit in der Zukunft passt zu keiner gesendeten Nachricht.
  assert.equal((buttonValid(buttonData(9, "siren", T + 6 * MIN), T, cams) as Extract<ButtonCheck, { ok: false }>).why, "verstuemmelt");
  // Ein paar Minuten voraus (Uhr nachgestellt) gilt noch.
  assert.equal(buttonValid(buttonData(9, "siren", T + 4 * MIN), T, cams).ok, true);
});

test("buttonValid: die Kamera gibt es nicht mehr", () => {
  assert.deepEqual(buttonValid("cam:12:snap", T, cams), { ok: false, why: "kamera", camera: 12, button: "snap" });
  assert.deepEqual(buttonValid(buttonData(12, "siren", T), T, cams), { ok: false, why: "kamera", camera: 12, button: "siren" });
  // Auch abgelaufen: Die fehlende Kamera wird genannt.
  assert.equal((buttonValid(buttonData(12, "siren", T), T + 60 * MIN, cams) as Extract<ButtonCheck, { ok: false }>).why, "kamera");
});

test("buttonTool: dieselben Werkzeuge wie bisher, Licht und Sirene nur einschalten", () => {
  assert.deepEqual(buttonTool(9, "snap", "Eingang"), { tool: "camera_snapshot", args: { camera: "9" }, desc: "Neues Bild Eingang" });
  assert.deepEqual(buttonTool(9, "spot", "Eingang"), {
    tool: "camera_control",
    args: { camera: "9", what: "spotlight", on: true },
    desc: "Eingang: Licht an",
  });
  assert.deepEqual(buttonTool(9, "siren", "Eingang"), { tool: "camera_control", args: { camera: "9", what: "siren", on: true }, desc: "Eingang: Sirene an" });
});

test("buttonRefusalLine: Log-Zeile je Grund", () => {
  const siren = buttonData(3, "siren", T);
  const expired = buttonValid(siren, T + 14 * MIN, cams) as Extract<ButtonCheck, { ok: false }>;
  assert.equal(buttonRefusalLine(expired, siren), "Knopf „Sirene“ (Kamera 3) abgelaufen: gilt 10 min, die Nachricht ist 14 min alt");
  const gone = buttonValid("cam:12:snap", T, cams) as Extract<ButtonCheck, { ok: false }>;
  assert.equal(buttonRefusalLine(gone, "cam:12:snap"), "Knopf „Neues Bild“ (Kamera 12) nicht ausgeführt: die Kamera gibt es nicht mehr");
  const broken = buttonValid("cam:9:boom", T, cams) as Extract<ButtonCheck, { ok: false }>;
  assert.equal(buttonRefusalLine(broken, "cam:9:boom"), 'Knopf mit unbekannten Daten abgelehnt: "cam:9:boom"');
});
