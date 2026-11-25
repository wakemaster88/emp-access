/**
 * Zustellung der Nachrichten des Waechters: verbindet die Sende-Warteschlange
 * (outbox.ts, Regeln in outbox-rules.ts) mit dem Telegram-Bot, dem Log, den
 * Zaehlern und dem KI-Protokoll der Zentrale.
 *
 *  - Alarm: Bild mit Text und Knoepfen, mit Ton. Scheitert das Bild, geht der
 *    Text mit den Knoepfen allein hinaus. Erreicht der Alarm keinen Chat,
 *    steht er als Befund beim Zustands-Waechter (undeliveredAlarms); die Liste
 *    dazu liegt in .cache/agent-undelivered.json und uebersteht einen Neustart.
 *  - Zusatzbilder eines Alarms (Uebersicht, Bildserie): in derselben Reihe
 *    hinter dem Alarm, ohne Text-Rueckfall und ohne Ton. Nur wo der Alarm den
 *    Chat nicht erreicht hat, kommt das erste Zusatzbild, das dort ankommt,
 *    mit Ton (imageSilent): Ein Alarm klingelt in jedem Chat einmal.
 *  - Meldungen des Zustands-Waechters, Tagesvorschau und Tagesbericht: Text.
 *
 * Im Log steht jede Zustellung, die mehr als einen Versuch gebraucht hat, und
 * jede Nachricht, die nicht zugestellt wurde. Die Zaehler fuehren auch die
 * Zustellungen beim ersten Versuch.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../atomic-file.js";
import { CONFIG, log } from "../config.js";
import { improveCount, type ImproveKind } from "../improve-log.js";
import { recordActivity } from "./activity.js";
import type { Finding } from "./findings.js";
import { Outbox, type OutMessage } from "./outbox.js";
import {
  addUndelivered,
  deliveryCounter,
  deliveryLine,
  deliveryTrouble,
  dueAgain,
  imageSilent,
  markSeenAtExit,
  OPEN_AT_EXIT,
  pruneUndelivered,
  restoreUndelivered,
  serializeUndelivered,
  undeliveredFinding,
  type OutResult,
  type UndeliveredAlarm,
} from "./outbox-rules.js";
import { pollFailingSince, sendPhoto, sendText, type TgButton } from "./telegram.js";

interface Meta {
  /** Name der Nachricht in Log-Zeilen, z. B. „Wächter: Alarm Eingang“. */
  label: string;
  /** Zaehler: `<kind>.<counter>_ok|retry|text|failed`. */
  kind: ImproveKind;
  counter: string;
  /** Kamera eines Alarms (fuer das KI-Protokoll). */
  camera?: string;
  /**
   * Ausgang eines Alarms je Chat merken (sendAlarm), bei einem Zusatzbild,
   * ob es mit Ton ankam (sendAlarmImage). Laeuft beim Verbuchen, also bevor
   * die Reihe das naechste Bild des Chats versucht.
   */
  onSettled?: (ok: boolean) => void;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Hinweis am Text eines Alarms, dessen Bild Telegram nicht erreicht hat (das Bild kommt dann ins KI-Protokoll). */
const NO_PHOTO_NOTE = "\nBild nicht übertragen, es steht in der Zentrale unter KI.";
const NO_CHAT_LOG_MS = 60 * 60_000;

function report(msg: OutMessage<Meta>, r: OutResult): void {
  const { meta } = msg;
  meta.onSettled?.(r.ok);
  improveCount(meta.kind, `${meta.counter}_${deliveryCounter(r)}`);
  const line = deliveryLine(meta.label, r);
  if (line) log(line);
  // Text und Bild eines Alarms, die Telegram nicht oder nur ohne Bild erreicht
  // haben, bleiben im KI-Protokoll der Zentrale.
  if (msg.textFallback && msg.jpeg && (!r.ok || r.asText)) {
    recordActivity({
      kind: "alert",
      where: meta.camera,
      text: `${msg.text}\n(${r.ok ? "an Telegram ohne Bild zugestellt" : "nicht an Telegram zugestellt"})`,
      jpeg: msg.jpeg,
    });
  }
}

const OUTBOX = new Outbox<Meta>({
  photo: sendPhoto,
  text: sendText,
  onResult: report,
  onError: (e) => log(`Wächter: Zustellung: ${errText(e)}`),
});

/** Bei mehreren gekoppelten Chats nennt die Log-Zeile den Chat. */
const toChat = (chatIds: string[], chatId: string) => (chatIds.length > 1 ? ` an Chat ${chatId}` : "");

/* ------------------------------------------------------------ Alarm */

/** Alarme, die keinen Chat erreicht haben. */
let undelivered: UndeliveredAlarm[] = [];
/** Alarme, deren Ausgang noch nicht verbucht ist (closeDispatch wartet darauf). */
const booking = new Set<Promise<void>>();
/** Kamera und Zeit der Alarme in `booking`: Beim Beenden stehen sie vorsorglich auf der Platte. */
const openAlarms = new Map<Promise<void>, { camera: string; at: number }>();
/** Der Hub endet (closeDispatch): Offene Alarme gelten auf der Platte als nicht zugestellt. */
let closing = false;
let noChatLoggedAt: number | null = null;
let noChatSkipped = 0;

export interface AlarmMessage {
  chatIds: string[];
  camera: string;
  jpeg: Buffer;
  caption: string;
  /** Knoepfe; als Funktion je Versuch mit dessen Zeitpunkt (Knoepfe mit Frist, alarm-rules.ts). */
  buttons?: TgButton[][] | ((sentAt: number) => TgButton[][]);
  /** Je Chat, den der Alarm erreicht hat. */
  onDelivered?: () => void;
}

/** Ein eingereihter Alarm: Hat er einen Chat erreicht? null = Ausgang noch offen. */
export interface SentAlarm {
  reached(chatId: string): boolean | null;
  /** Ein Zusatzbild des Alarms kam im Chat mit Ton an. */
  rang(chatId: string): boolean;
  noteRang(chatId: string): void;
}

const NO_ALARM: SentAlarm = { reached: () => null, rang: () => false, noteRang: () => undefined };

/**
 * Alarm des Waechters an alle gekoppelten Chats. Kehrt sofort zurueck: Die
 * Bewertung der naechsten Kamera wartet nicht auf die Zustellung. Das
 * Ergebnis geben die Zusatzbilder des Alarms an sendAlarmImage weiter.
 */
export function sendAlarm(a: AlarmMessage): SentAlarm {
  if (!a.chatIds.length) {
    noChat(a);
    return NO_ALARM;
  }
  const at = Date.now();
  /** Ausgang je Chat, sobald er feststeht. */
  const reached = new Map<string, boolean>();
  const results = a.chatIds.map((chatId) =>
    OUTBOX.enqueue({
      chatId,
      text: a.caption,
      jpeg: a.jpeg,
      buttons: a.buttons,
      textFallback: { note: NO_PHOTO_NOTE },
      meta: {
        label: `Wächter: Alarm ${a.camera}${toChat(a.chatIds, chatId)}`,
        kind: "camera",
        counter: "sentinel_send",
        camera: a.camera,
        onSettled: (ok) => reached.set(chatId, ok),
      },
    })
  );
  const booked: Promise<void> = Promise.all(results)
    .then((rs) => {
      if (rs.some((r) => r.ok)) return;
      openAlarms.delete(booked);
      const last = rs[rs.length - 1];
      const now = Date.now();
      undelivered = addUndelivered(undelivered, { camera: a.camera, at, failedAt: now, reason: last.ok ? "" : last.reason }, now);
      improveCount("camera", "sentinel_alarm_lost");
      return saveUndelivered();
    })
    .catch((e) => log(`Wächter: Zustellung: ${errText(e)}`))
    .finally(() => {
      openAlarms.delete(booked);
      booking.delete(booked);
    });
  for (const r of results) {
    void r
      .then((res) => {
        if (!res.ok) return;
        // Ein Chat hat ihn: Er gilt nicht mehr als offen. Stand er beim Beenden
        // schon vorsorglich in der Datei, wird er dort wieder ausgetragen.
        if (openAlarms.delete(booked) && closing) void saveUndelivered();
        a.onDelivered?.();
      })
      .catch(() => undefined);
  }
  booking.add(booked);
  openAlarms.set(booked, { camera: a.camera, at });
  /** Chats, in denen ein Zusatzbild des Alarms mit Ton ankam. */
  const rang = new Set<string>();
  return { reached: (chatId) => reached.get(chatId) ?? null, rang: (chatId) => rang.has(chatId), noteRang: (chatId) => void rang.add(chatId) };
}

/** Kein Chat gekoppelt: Der Alarm bleibt im KI-Protokoll, im Log steht hoechstens eine Zeile je Stunde. */
function noChat(a: AlarmMessage): void {
  improveCount("camera", "sentinel_send_nochat");
  recordActivity({ kind: "alert", where: a.camera, text: `${a.caption}\n(kein Telegram-Chat gekoppelt)`, jpeg: a.jpeg });
  noChatSkipped++;
  const now = Date.now();
  if (!dueAgain(noChatLoggedAt, now, NO_CHAT_LOG_MS)) return;
  log(
    `Wächter: Alarm ${a.camera} nicht gesendet, kein Telegram-Chat gekoppelt` +
      (noChatSkipped > 1 ? ` (${noChatSkipped} Alarme seit der letzten Zeile dazu)` : "")
  );
  noChatLoggedAt = now;
  noChatSkipped = 0;
}

/**
 * Zusatzbild eines Alarms (Uebersicht, Bildserie): in der Reihe hinter dem
 * Alarm, ohne Ton, ausser der Alarm hat diesen Chat nicht erreicht und noch
 * kein Bild des Alarms kam dort mit Ton an.
 */
export function sendAlarmImage(a: { chatIds: string[]; jpeg: Buffer; caption: string; alarm: SentAlarm }): void {
  for (const chatId of a.chatIds) {
    /** Ging der letzte Versuch mit Ton hinaus? */
    let loud = false;
    void OUTBOX.enqueue({
      chatId,
      text: a.caption,
      jpeg: a.jpeg,
      optional: true,
      silent: () => {
        const silent = imageSilent(a.alarm.reached(chatId), a.alarm.rang(chatId));
        loud = !silent;
        return silent;
      },
      meta: {
        label: `Wächter: Bild ${a.caption}${toChat(a.chatIds, chatId)}`,
        kind: "camera",
        counter: "sentinel_image",
        onSettled: (ok) => {
          if (ok && loud) a.alarm.noteRang(chatId);
        },
      },
    });
  }
}

/**
 * Ist die Zustellung der Alarme gerade gestoert (deliveryTrouble)? Dann steht
 * keine Kamera in der Liste fuer die Cloud, und die Cloud meldet selbst.
 * null = keine Stoerung bekannt.
 */
export function alarmDeliveryTrouble(now = Date.now()): string | null {
  const open = [...openAlarms.values()].map((o) => o.at);
  const lost = undelivered.map((a) => a.failedAt);
  return deliveryTrouble({
    now,
    openSince: open.length ? Math.min(...open) : null,
    lastLostAt: lost.length ? Math.max(...lost) : null,
    pollFailingSince: pollFailingSince(),
  });
}

/** Befund fuer Alarme, die keinen Chat erreicht haben (watch.ts, collectFindings); null = keiner. */
export function undeliveredAlarms(now = Date.now()): Finding | null {
  return undeliveredFinding(undelivered, now);
}

function undeliveredPath(): string {
  return path.join(CONFIG.hubDir, ".cache", "agent-undelivered.json");
}

/** Schreibvorgaenge laufen nacheinander: Sie teilen sich die zweite Datei (atomic-file.ts). */
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Was auf die Platte kommt: die nicht zugestellten Alarme, beim Beenden dazu
 * die, deren Zustellung noch laeuft. Endet der Prozess, bevor sie feststeht,
 * stehen sie nach dem Neustart unter den Befunden.
 */
function diskList(now: number): UndeliveredAlarm[] {
  if (!closing || openAlarms.size === 0) return undelivered;
  const open = [...openAlarms.values()].map((o) => ({ camera: o.camera, at: o.at, failedAt: now, reason: OPEN_AT_EXIT }));
  return pruneUndelivered([...undelivered, ...open], now);
}

/** Liste speichern. Ein Fehler steht im Log, die Liste im Speicher gilt weiter. */
function saveUndelivered(): Promise<void> {
  writeQueue = writeQueue
    .then(() => writeFileAtomic(undeliveredPath(), serializeUndelivered(diskList(Date.now()))))
    .catch((e) => log(`Wächter: Liste der nicht zugestellten Alarme nicht gespeichert: ${errText(e)}`));
  return writeQueue;
}

/**
 * Beim Start des Assistenten: Alarme, die vor dem Neustart keinen Chat
 * erreicht haben, stehen wieder unter den Befunden. Eine fehlende Datei
 * heisst: Es gab keinen.
 */
export async function loadDispatch(): Promise<void> {
  let json: string;
  try {
    json = await readFile(undeliveredPath(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code !== "ENOENT") log(`Wächter: Liste der nicht zugestellten Alarme nicht lesbar: ${errText(e)}`);
    return;
  }
  const now = Date.now();
  // Beim letzten Beenden offene Alarme stehen einmal im Log; danach gelten sie
  // als gesehen, damit ein weiterer Neustart die Zeile nicht wiederholt.
  const { list: restored, fresh } = markSeenAtExit(restoreUndelivered(json, now));
  if (fresh > 0) log(`Wächter: ${fresh} ${fresh === 1 ? "Alarm" : "Alarme"} beim letzten Beenden nicht zugestellt`);
  undelivered = pruneUndelivered(
    [...restored, ...undelivered].sort((a, b) => a.failedAt - b.failedAt),
    now
  );
  if (fresh > 0) await saveUndelivered();
}

/* ------------------------------------------------------------ Text */

export type NoticeKind = "zustand" | "vorschau" | "bericht";

const NOTICE: Record<NoticeKind, { label: string; counter: string }> = {
  zustand: { label: "Zustands-Wächter: Meldung", counter: "watch_send" },
  vorschau: { label: "Assistent: Tagesvorschau", counter: "preview_send" },
  bericht: { label: "Assistent: Tagesbericht", counter: "report_send" },
};

export interface NoticeResult {
  /** Der Text hat mindestens einen Chat erreicht. */
  delivered: boolean;
  /** Telegram hat ihn fuer jeden Chat abgelehnt: Ein spaeterer Versuch aendert nichts. */
  rejected: boolean;
}

/** Text an alle Chats, mit Wiederholung. Das Ergebnis kommt, wenn fuer jeden Chat feststeht, ob er angekommen ist. */
export async function sendNotice(chatIds: string[], text: string, kind: NoticeKind): Promise<NoticeResult> {
  const { label, counter } = NOTICE[kind];
  const results = await Promise.all(
    chatIds.map((chatId) => OUTBOX.enqueue({ chatId, text, meta: { label: `${label}${toChat(chatIds, chatId)}`, kind: "agent", counter } }))
  );
  const delivered = results.some((r) => r.ok);
  return { delivered, rejected: !delivered && results.length > 0 && results.every((r) => !r.ok && r.permanent) };
}

/* ------------------------------------------------------------ Beenden */

/**
 * Vor dem Beenden des Hubs: Ein Alarm, der noch auf seinen naechsten Versuch
 * wartet, geht ein letztes Mal als Text hinaus. Was dann noch offen ist, steht
 * als nicht zugestellt im Log; ein Alarm, der so keinen Chat erreicht hat,
 * kommt in die gespeicherte Liste und steht nach dem Neustart unter den
 * Befunden. Weil das Beenden nur 3 s wartet, stehen offene Alarme schon vor
 * dem letzten Versuch in der Liste und werden bei Zustellung wieder
 * ausgetragen.
 */
export async function closeDispatch(): Promise<void> {
  closing = true;
  if (openAlarms.size > 0) await saveUndelivered();
  await OUTBOX.close();
  await Promise.all([...booking]);
  await writeQueue;
}
