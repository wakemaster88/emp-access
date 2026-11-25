/**
 * Sende-Warteschlange fuer die Nachrichten des Waechters.
 *
 * Je Chat eine Reihe: Die Nachrichten gehen in der Reihenfolge hinaus, in der
 * sie eingereiht wurden, die naechste erst, wenn die davor zugestellt oder
 * aufgegeben ist. So bleibt die Reihenfolge der Bilder eines Alarms erhalten,
 * und ein Chat, der nicht erreichbar ist, haelt die anderen nicht auf. Wer
 * einreiht, wartet nicht auf die Zustellung: `enqueue` liefert ein Versprechen
 * auf den Ausgang, das nie scheitert.
 *
 * Wann wiederholt wird, wann eine Nachricht ohne Bild hinausgeht und wann sie
 * als nicht zugestellt gilt, steht in outbox-rules.ts. Die Warteschlange lebt
 * im Speicher. Ohne Hub-Konfiguration: Sender, Uhr und Wartezeit kommen vom
 * Aufrufer (dispatch.ts verbindet sie mit dem Telegram-Bot).
 */
import type { SendOptions, TgButton } from "./telegram.js";
import {
  CLOSED_PHOTO_NOTE,
  CLOSED_REASON,
  MAX_AGE_MS,
  MAX_WAITING,
  acceptsMessage,
  afterFailure,
  attemptMode,
  classifyFailure,
  type OutResult,
  type SendFailure,
} from "./outbox-rules.js";

export interface OutMessage<M = unknown> {
  chatId: string;
  /** Text der Nachricht bzw. Bildunterschrift. */
  text: string;
  jpeg?: Buffer;
  /**
   * Knoepfe; sie bleiben an der Nachricht, auch wenn sie ohne Bild hinausgeht.
   * Eine Funktion bekommt vor jedem Versuch dessen Zeitpunkt: So tragen
   * Knoepfe mit Frist die Zeit der Nachricht, die ankommt (alarm-rules.ts).
   */
  buttons?: TgButton[][] | ((sentAt: number) => TgButton[][]);
  /**
   * Der Text sagt auch ohne Bild, was los ist (Alarm): Scheitert das Bild,
   * geht er allein hinaus, ergaenzt um `note`.
   */
  textFallback?: { note: string };
  /** Zusatzbild (Uebersicht, Bildserie): wird bei voller Reihe nicht mehr angenommen. */
  optional?: boolean;
  /**
   * Ohne Ton senden (disable_notification), bei jedem Versuch gleich. Eine
   * Funktion wird vor jedem Versuch gefragt: So richtet sich ein Zusatzbild
   * danach, ob der Alarm davor den Chat erreicht hat (dispatch.ts).
   */
  silent?: boolean | (() => boolean);
  /** Angaben des Aufrufers fuer Log und Zaehler. */
  meta: M;
}

export interface OutboxDeps<M = unknown> {
  /** Bild senden; wirft, wenn es nicht angekommen ist. */
  photo: (chatId: string, jpeg: Buffer, caption: string, buttons?: TgButton[][], opts?: SendOptions) => Promise<unknown>;
  /** Text senden; wirft, wenn er nicht angekommen ist. */
  text: (chatId: string, text: string, buttons?: TgButton[][], opts?: SendOptions) => Promise<unknown>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Ausgang jeder Nachricht, genau einmal (Log, Zaehler). */
  onResult?: (msg: OutMessage<M>, result: OutResult) => void;
  /** Fehler in der Warteschlange selbst oder in `onResult`. */
  onError?: (e: unknown) => void;
  maxAgeMs?: number;
}

/** Sendeoptionen fuer den naechsten Versuch einer Nachricht. Scheitert die Frage nach `silent`, geht sie mit Ton hinaus. */
function sendOptions(msg: OutMessage<unknown>): SendOptions {
  if (typeof msg.silent !== "function") return { silent: msg.silent === true };
  try {
    return { silent: msg.silent() === true };
  } catch {
    return { silent: false };
  }
}

interface Entry<M> {
  msg: OutMessage<M>;
  queuedAt: number;
  tries: number;
  /** Das Bild ist aufgegeben, die Nachricht geht als Text hinaus. */
  textOnly: boolean;
  /** Woran das Bild zuletzt gescheitert ist. */
  photoError: string | null;
  /** Ein Versuch laeuft gerade. */
  sending: boolean;
  /** `close` hat die Nachricht uebernommen und meldet ihren Ausgang. */
  closing: boolean;
  settled: boolean;
  resolve: (r: OutResult) => void;
  /** Der Ausgang der Nachricht (das, was `enqueue` zurueckgibt). */
  done: Promise<OutResult>;
}

export class Outbox<M = unknown> {
  private readonly lanes = new Map<string, Entry<M>[]>();
  private readonly maxAgeMs: number;
  private closed = false;

  constructor(private readonly deps: OutboxDeps<M>) {
    this.maxAgeMs = deps.maxAgeMs ?? MAX_AGE_MS;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return this.deps.sleep ? this.deps.sleep(ms) : new Promise((r) => setTimeout(r, ms));
  }

  /** Knoepfe fuer einen Versuch. Scheitert die Funktion, geht die Nachricht ohne Knoepfe hinaus. */
  private buttonsFor(msg: OutMessage<M>): TgButton[][] | undefined {
    if (typeof msg.buttons !== "function") return msg.buttons;
    try {
      return msg.buttons(this.now());
    } catch (err) {
      this.report(err);
      return undefined;
    }
  }

  /** Fehler melden; die Warteschlange arbeitet in jedem Fall weiter. */
  private report(err: unknown): void {
    try {
      this.deps.onError?.(err);
    } catch {
      // Auch die Meldung ist gescheitert: nichts mehr zu tun.
    }
  }

  /** Nachrichten, deren Ausgang noch offen ist. */
  pending(): number {
    let n = 0;
    for (const lane of this.lanes.values()) n += lane.filter((e) => !e.settled).length;
    return n;
  }

  /**
   * Nachricht einreihen. Das Ergebnis kommt, sobald sie zugestellt oder
   * aufgegeben ist; es scheitert nie. Nach einem gelungenen Versuch gibt es
   * fuer die Nachricht keinen weiteren.
   */
  enqueue(msg: OutMessage<M>): Promise<OutResult> {
    let resolve!: (r: OutResult) => void;
    const done = new Promise<OutResult>((r) => {
      resolve = r;
    });
    const entry: Entry<M> = {
      msg,
      queuedAt: this.now(),
      tries: 0,
      textOnly: false,
      photoError: null,
      sending: false,
      closing: false,
      settled: false,
      resolve,
      done,
    };
    const lane = this.lanes.get(msg.chatId);
    if (this.closed) {
      this.settle(entry, this.failed(entry, CLOSED_REASON, false));
    } else if (!lane) {
      const fresh = [entry];
      this.lanes.set(msg.chatId, fresh);
      void this.run(msg.chatId, fresh).catch((e) => this.report(e));
    } else if (acceptsMessage(lane.length, msg.optional === true)) {
      lane.push(entry);
    } else {
      this.settle(entry, this.failed(entry, `Warteschlange voll (${MAX_WAITING} Nachrichten warten)`, false));
    }
    return done;
  }

  /**
   * Beim Beenden des Hubs: nichts mehr annehmen, nichts mehr wiederholen. Ein
   * wartender Alarm (Nachricht mit Text-Rueckfall) bekommt einen letzten
   * Versuch als Text ohne Bild, alles andere gilt als nicht zugestellt. Ein
   * Versuch, der gerade laeuft, wird abgewartet und meldet seinen Ausgang
   * selbst. Kehrt zurueck, wenn der Ausgang jeder Nachricht feststeht.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const open: Promise<unknown>[] = [];
    for (const lane of this.lanes.values()) {
      for (const e of lane) {
        if (e.settled) continue;
        if (e.sending) {
          open.push(e.done);
          continue;
        }
        e.closing = true;
        if (e.msg.textFallback) open.push(this.lastTry(e).then((r) => this.settle(e, r)));
        else this.settle(e, this.failed(e, CLOSED_REASON, false));
      }
    }
    await Promise.all(open);
  }

  /** Letzter Versuch beim Beenden: der Text eines Alarms ohne sein Bild. Scheitert nie. */
  private async lastTry(e: Entry<M>): Promise<OutResult> {
    const { msg } = e;
    e.tries++;
    try {
      await this.deps.text(msg.chatId, msg.jpeg ? msg.text + CLOSED_PHOTO_NOTE : msg.text, this.buttonsFor(msg), sendOptions(msg));
      return { ok: true, tries: e.tries, ms: this.now() - e.queuedAt, asText: !!msg.jpeg, photoError: e.photoError ?? CLOSED_REASON };
    } catch (err) {
      const f = classifyFailure(err);
      return this.failed(e, `${f.reason} (${CLOSED_REASON})`, !f.retry);
    }
  }

  private failed(e: Entry<M>, reason: string, permanent: boolean): OutResult {
    return { ok: false, tries: e.tries, ms: this.now() - e.queuedAt, reason, permanent };
  }

  private settle(e: Entry<M>, result: OutResult): void {
    if (e.settled) return;
    e.settled = true;
    try {
      this.deps.onResult?.(e.msg, result);
    } catch (err) {
      this.report(err);
    }
    e.resolve(result);
  }

  /** Die Reihe eines Chats abarbeiten, bis sie leer ist. */
  private async run(chatId: string, lane: Entry<M>[]): Promise<void> {
    while (lane.length) {
      const e = lane[0];
      if (!e.settled && !e.closing) {
        let result: OutResult;
        try {
          result = await this.deliver(e);
        } catch (err) {
          result = this.failed(e, err instanceof Error ? err.message : String(err), false);
        }
        // Hat `close` die Nachricht inzwischen uebernommen, meldet es ihren Ausgang.
        if (!e.closing) this.settle(e, result);
      }
      lane.shift();
    }
    this.lanes.delete(chatId);
  }

  /** Eine Nachricht versuchen, bis sie zugestellt oder aufgegeben ist. */
  private async deliver(e: Entry<M>): Promise<OutResult> {
    const { msg } = e;
    const textFallback = msg.textFallback !== undefined;
    for (;;) {
      if (this.closed) return this.failed(e, CLOSED_REASON, false);
      const mode = attemptMode({ hasPhoto: !!msg.jpeg, textOnly: e.textOnly, textFallback, queuedAt: e.queuedAt, now: this.now(), maxAgeMs: this.maxAgeMs });
      const noPhoto = !!msg.jpeg && mode === "text";
      e.tries++;
      e.sending = true;
      let failure: SendFailure;
      try {
        const opts = sendOptions(msg);
        const buttons = this.buttonsFor(msg);
        if (mode === "foto" && msg.jpeg) await this.deps.photo(msg.chatId, msg.jpeg, msg.text, buttons, opts);
        else await this.deps.text(msg.chatId, noPhoto ? msg.text + (msg.textFallback?.note ?? "") : msg.text, buttons, opts);
        return { ok: true, tries: e.tries, ms: this.now() - e.queuedAt, asText: noPhoto, photoError: noPhoto ? e.photoError : null };
      } catch (err) {
        failure = classifyFailure(err);
      } finally {
        e.sending = false;
      }
      if (mode === "foto") e.photoError = failure.reason;
      if (this.closed) {
        // Beim Beenden gescheitert: Der Text eines Alarms geht noch einmal ohne Bild hinaus.
        if (mode === "foto" && textFallback) return this.lastTry(e);
        return this.failed(e, `${failure.reason} (${CLOSED_REASON})`, !failure.retry);
      }
      const next = afterFailure(
        { tries: e.tries, queuedAt: e.queuedAt, now: this.now(), maxAgeMs: this.maxAgeMs, withPhoto: mode === "foto", textFallback },
        failure,
      );
      if (next.then === "give_up") return this.failed(e, failure.reason, !failure.retry);
      if (next.then === "text") e.textOnly = true;
      const wait = next.at - this.now();
      if (wait > 0) await this.sleep(wait);
    }
  }
}
