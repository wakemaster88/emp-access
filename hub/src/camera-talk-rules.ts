/**
 * Fristen und Reihenfolge der Ansagen über den Kamera-Lautsprecher (ohne
 * Abhängigkeiten zum Hub, testbar). Die RTSP-Sitzung und die Sprach-Erzeugung
 * stehen in camera-talk.ts.
 *
 * Eine Ansage endet in jedem Fall: Jedes Schreiben prüft vorher, ob die
 * Verbindung noch steht; auf das Abfließen der Daten wird höchstens
 * DRAIN_WAIT_MS gewartet, und nur, solange die Verbindung weder endet noch
 * einen Fehler meldet; die ganze Sitzung hat eine Gesamtfrist
 * (talkDeadlineMs). Je Kamera spricht eine Ansage nach der anderen
 * (TalkQueue), und eine gescheiterte hält die nächste nicht auf.
 */

/** Höchstens so lange auf das Abfließen der Daten warten. */
export const DRAIN_WAIT_MS = 5_000;
/** Zeitlimit für `say` und `afconvert` je Aufruf. */
export const SPEECH_TOOL_TIMEOUT_MS = 15_000;
/** Zuschlag auf die Länge der Ansage für Verbindung, Rückkanal und Abbau. */
export const TALK_GRACE_MS = 10_000;

/** Gesamtfrist einer Ansage: ihre Länge plus TALK_GRACE_MS. */
export function talkDeadlineMs(seconds: number): number {
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  return Math.ceil(ms) + TALK_GRACE_MS;
}

type Listener = (...args: unknown[]) => void;

/** Was die Sende-Schleife von der Verbindung braucht; net.Socket erfüllt das. */
export interface PacketSink {
  write(chunk: Uint8Array): boolean;
  readonly destroyed: boolean;
  readonly writableEnded: boolean;
  once(event: "drain" | "close" | "error", listener: Listener): unknown;
  off(event: "drain" | "close" | "error", listener: Listener): unknown;
}

/** Steht die Verbindung noch (nicht zerstört, nicht beendet)? */
export function sinkOpen(sink: Pick<PacketSink, "destroyed" | "writableEnded">): boolean {
  return !sink.destroyed && !sink.writableEnded;
}

/**
 * Auf `drain` warten, höchstens `ms`. Endet die Verbindung vorher oder meldet
 * sie einen Fehler, scheitert das Warten sofort: Nach einem Abbruch kommt
 * `drain` nie.
 */
export function waitForDrain(sink: PacketSink, ms: number): Promise<void> {
  if (!sinkOpen(sink)) return Promise.reject(new Error("Verbindung zur Kamera beendet"));
  return new Promise<void>((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer);
      sink.off("drain", onDrain);
      sink.off("close", onClose);
      sink.off("error", onError);
      fn();
    };
    const onDrain = () => done(resolve);
    const onClose = () => done(() => reject(new Error("Verbindung zur Kamera beendet")));
    const onError = (err: unknown) =>
      done(() => reject(err instanceof Error ? err : new Error(String(err))));
    const timer = setTimeout(
      () => done(() => reject(new Error(`Kamera nimmt keine Daten an (${Math.round(ms / 1000)} s)`))),
      ms,
    );
    sink.once("drain", onDrain);
    sink.once("close", onClose);
    sink.once("error", onError);
  });
}

export interface SendOptions {
  /** Bytes je Paket (PCMU: 160 = 20 ms). */
  packetBytes: number;
  /** Abstand der Pakete in ms. */
  packetMs: number;
  /** Höchstens so lange auf das Abfließen warten (Standard DRAIN_WAIT_MS). */
  drainWaitMs?: number;
  /** Zufallswerte des RTP-Kopfs; im Test fest. */
  ssrc?: number;
  seq?: number;
  /** Uhr und Warten; im Test austauschbar. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Ein RTP-Paket (PCMU) im "$"-Rahmen für RTP über TCP (RFC 2326, interleaved, Kanal 0). */
export function rtpFrame(payload: Uint8Array, seq: number, timestamp: number, ssrc: number): Buffer {
  const framed = Buffer.alloc(4 + 12 + payload.length);
  framed[0] = 0x24;
  framed[1] = 0x00;
  framed.writeUInt16BE(12 + payload.length, 2);
  framed[4] = 0x80; // Version 2, keine Erweiterungen.
  framed[5] = 0x00; // Payload-Typ 0 = PCMU.
  framed.writeUInt16BE(seq & 0xffff, 6);
  framed.writeUInt32BE(timestamp >>> 0, 8);
  framed.writeUInt32BE(ssrc >>> 0, 12);
  framed.set(payload, 16);
  return framed;
}

/**
 * PCMU in RTP-Paketen senden, im Tempo der Wiedergabe. Vor jedem Schreiben
 * wird geprüft, ob die Verbindung noch steht; nimmt sie keine Daten mehr an,
 * wird höchstens `drainWaitMs` gewartet. Bricht die Verbindung ab, endet das
 * Senden mit einem Fehler statt zu warten.
 */
export async function sendPcmu(sink: PacketSink, audio: Uint8Array, opts: SendOptions): Promise<{ packets: number }> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const drainWaitMs = opts.drainWaitMs ?? DRAIN_WAIT_MS;
  const ssrc = (opts.ssrc ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
  let seq = opts.seq ?? Math.floor(Math.random() * 0xffff);
  let timestamp = 0;
  const startedAt = now();
  let packets = 0;

  for (let offset = 0, packet = 0; offset < audio.length; offset += opts.packetBytes, packet++) {
    if (!sinkOpen(sink)) throw new Error("Verbindung zur Kamera beendet");
    const slice = audio.subarray(offset, offset + opts.packetBytes);
    seq = (seq + 1) & 0xffff;
    const framed = rtpFrame(slice, seq, timestamp, ssrc);
    timestamp = (timestamp + slice.length) >>> 0;
    if (!sink.write(framed)) await waitForDrain(sink, drainWaitMs);
    packets++;

    // Absolute Zeitplanung, damit sich der Takt nicht aufsummiert.
    const wait = startedAt + (packet + 1) * opts.packetMs - now();
    if (wait > 0) await sleep(wait);
  }
  return { packets };
}

/**
 * `work` mit Frist: Nach `ms` wird `onTimeout` aufgerufen (Verbindung
 * beenden) und das Ergebnis ist ein Fehler. Endet `work` später doch noch,
 * wird das still verworfen.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => void, label = "Frist"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        onTimeout();
      } catch {
        // Aufräumen darf das Ergebnis nicht ändern.
      }
      reject(new Error(`${label} überschritten (${Math.round(ms / 1000)} s)`));
    }, ms);
    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Warteschlange je Kamera: Ansagen auf derselben Kamera laufen nacheinander
 * in der Reihenfolge des Aufrufs, damit sich zwei Stimmen nicht überlagern.
 * Eine gescheiterte Ansage gibt die Reihe frei wie eine gelungene; Ansagen
 * auf verschiedenen Kameras laufen nebeneinander.
 */
export class TalkQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly counts = new Map<string, number>();

  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    const result = previous.then(job);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      const left = (this.counts.get(key) ?? 1) - 1;
      if (left > 0) this.counts.set(key, left);
      else this.counts.delete(key);
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** Ansagen dieser Kamera, die laufen oder warten. */
  pending(key: string): number {
    return this.counts.get(key) ?? 0;
  }
}
