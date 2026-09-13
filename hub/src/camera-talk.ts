/**
 * Durchsagen über den Lautsprecher einer Reolink-Kamera.
 *
 * Die CGI-API taugt dafür nicht: `GetAudioFileList`, `GetAudioAlarm` und
 * `GetAutoReply` antworten mit "not support", eigene Audiodateien lassen sich
 * nicht hochladen, und `AudioAlarmPlay` kann nur den eingebauten Alarmton.
 * Freie Ansagen gehen über den ONVIF-Audio-Backchannel: Ein DESCRIBE mit
 * `Require: www.onvif.org/ver20/backchannel` liefert einen zusätzlichen Track
 * `PCMU/8000` mit `a=sendonly`, in den wir RTP-Pakete schicken.
 *
 * Sprache erzeugt macOS selbst (`say` + `afconvert`), damit weder ffmpeg noch
 * ein Cloud-Dienst nötig ist – eine Ansage funktioniert so auch bei
 * Internet-Ausfall.
 *
 * Zwei Eigenheiten der Kamera, die Zeit kosten, wenn man sie nicht kennt:
 * `RECORD` beantwortet sie mit "405 Method Not Allowed" (es muss `PLAY` sein),
 * und der `Require`-Header gehört an SETUP und PLAY, nicht nur an DESCRIBE.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { CONFIG, log } from "./config.js";
import { improve } from "./improve-log.js";

const run = promisify(execFile);

/** PCMU: 8000 Samples/s, ein Byte je Sample, 20 ms je Paket. */
const SAMPLE_RATE = 8000;
const PACKET_MS = 20;
const PACKET_BYTES = (SAMPLE_RATE / 1000) * PACKET_MS;
const RTSP_TIMEOUT_MS = 8_000;
/** Lange Ansagen abschneiden – ein Lautsprecher am Eingang soll nicht predigen. */
const MAX_SECONDS = 30;
const VOICE = process.env.HUB_TALK_VOICE || "Anna";
const ONVIF_BACKCHANNEL = "www.onvif.org/ver20/backchannel";

export interface TalkTarget {
  host: string;
  username: string;
  password: string;
  /** Default 554. */
  rtspPort?: number;
  /** Reolink-Substream reicht – wir wollen nur den Audio-Rückkanal. */
  streamPath?: string;
  /** Nur für Logmeldungen. */
  label?: string;
}

/** Pro Kamera nur eine Ansage – sonst überlagern sich zwei Stimmen. */
const busy = new Map<string, Promise<void>>();

/* ---------------------------------------------------------------------------
 * Sprache erzeugen (mit kleinem Cache, `say` braucht rund eine Sekunde)
 * ------------------------------------------------------------------------- */

function cacheDir(): string {
  return path.join(CONFIG.hubDir, ".cache", "talk");
}

/** Text zu rohem PCMU (µ-law, 8 kHz, mono) – genau das Format des Backchannels. */
async function renderSpeech(text: string, voice: string): Promise<Buffer> {
  const key = createHash("sha1").update(`${voice}\u0000${text}`).digest("hex").slice(0, 16);
  const cached = path.join(cacheDir(), `${key}.ulaw`);
  try {
    return await readFile(cached);
  } catch {
    // Noch nicht erzeugt.
  }

  await mkdir(cacheDir(), { recursive: true });
  const wav = path.join(cacheDir(), `${key}.tmp.wav`);
  const ulawWav = path.join(cacheDir(), `${key}.tmp.ulaw.wav`);
  try {
    // 8 kHz direkt aus `say`; afconvert wandelt nur noch in µ-law.
    await run("say", ["-v", voice, "-o", wav, "--data-format=LEI16@8000", "--file-format=WAVE", text]);
    await run("afconvert", ["-f", "WAVE", "-d", "ulaw@8000", wav, ulawWav]);
    const raw = dataChunk(await readFile(ulawWav));
    await writeFile(cached, raw);
    return raw;
  } finally {
    await unlink(wav).catch(() => {});
    await unlink(ulawWav).catch(() => {});
  }
}

/** Nutzdaten aus der WAV-Datei ziehen; afconvert schreibt vor `data` weitere Chunks. */
function dataChunk(wav: Buffer): Buffer {
  let off = 12;
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    if (id === "data") {
      return wav.subarray(off + 8, Math.min(off + 8 + size, wav.length));
    }
    off += 8 + size + (size % 2); // Chunks sind auf gerade Länge gepolstert.
  }
  throw new Error("WAV ohne data-Chunk");
}

/* ---------------------------------------------------------------------------
 * RTSP-Sitzung auf dem Backchannel
 * ------------------------------------------------------------------------- */

class RtspTalk {
  private sock: net.Socket | null = null;
  private buf = Buffer.alloc(0);
  private cseq = 0;
  private realm: string | null = null;
  private nonce: string | null = null;
  private session: string | null = null;
  private readonly url: string;

  constructor(private readonly target: TalkTarget) {
    const port = target.rtspPort ?? 554;
    const stream = target.streamPath ?? "h264Preview_01_sub";
    this.url = `rtsp://${target.host}:${port}/${stream}`;
  }

  private digest(method: string, uri: string): string {
    const { username, password } = this.target;
    const ha1 = createHash("md5").update(`${username}:${this.realm}:${password}`).digest("hex");
    const ha2 = createHash("md5").update(`${method}:${uri}`).digest("hex");
    const response = createHash("md5").update(`${ha1}:${this.nonce}:${ha2}`).digest("hex");
    return (
      `Digest username="${username}", realm="${this.realm}", ` +
      `nonce="${this.nonce}", uri="${uri}", response="${response}"`
    );
  }

  async connect(): Promise<void> {
    const port = this.target.rtspPort ?? 554;
    const sock = net.createConnection({ host: this.target.host, port });
    sock.setNoDelay(true);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("RTSP-Verbindung Timeout")), RTSP_TIMEOUT_MS);
      sock.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      sock.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    this.sock = sock;
  }

  /** Antwort einlesen; die Kamera schickt Kopf und optionalen SDP-Rumpf. */
  private readReply(): Promise<string> {
    const sock = this.sock;
    if (!sock) throw new Error("RTSP nicht verbunden");
    return new Promise<string>((resolve, reject) => {
      const finish = (fn: () => void) => {
        clearTimeout(timer);
        sock.off("data", onData);
        sock.off("error", onError);
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error("RTSP-Timeout"))), RTSP_TIMEOUT_MS);
      const onError = (err: Error) => finish(() => reject(err));
      const check = () => {
        const end = this.buf.indexOf("\r\n\r\n");
        if (end < 0) return;
        const head = this.buf.toString("utf8", 0, end);
        const len = /Content-Length:\s*(\d+)/i.exec(head);
        const total = end + 4 + (len ? Number(len[1]) : 0);
        if (this.buf.length < total) return;
        const reply = this.buf.toString("utf8", 0, total);
        this.buf = this.buf.subarray(total);
        finish(() => resolve(reply));
      };
      const onData = (chunk: Buffer) => {
        this.buf = Buffer.concat([this.buf, chunk]);
        check();
      };
      sock.on("data", onData);
      sock.on("error", onError);
      check(); // Antwort kann schon im Puffer liegen.
    });
  }

  /** Anfrage senden, bei 401 einmal mit Digest wiederholen. */
  private async request(method: string, uri: string, extra: string[] = []): Promise<string> {
    const send = () => {
      const lines = [`${method} ${uri} RTSP/1.0`, `CSeq: ${++this.cseq}`, "User-Agent: emp-access-hub", ...extra];
      if (this.session) lines.push(`Session: ${this.session}`);
      // Ohne diesen Header verschweigt die Kamera den Rückkanal.
      if (method !== "OPTIONS") lines.push(`Require: ${ONVIF_BACKCHANNEL}`);
      if (this.realm) lines.push(`Authorization: ${this.digest(method, uri)}`);
      this.sock?.write(`${lines.join("\r\n")}\r\n\r\n`);
    };

    send();
    let reply = await this.readReply();
    if (reply.startsWith("RTSP/1.0 401")) {
      const m = /realm="([^"]+)"[\s\S]*?nonce="([^"]+)"/.exec(reply);
      if (!m) throw new Error("401 ohne verwertbare Digest-Angaben");
      this.realm = m[1];
      this.nonce = m[2];
      send();
      reply = await this.readReply();
    }
    const status = reply.split("\r\n")[0];
    if (!status.includes(" 200 ")) throw new Error(`${method} → ${status}`);
    return reply;
  }

  /** Backchannel öffnen; liefert den Track, in den wir senden dürfen. */
  async open(): Promise<void> {
    const sdp = await this.request("DESCRIBE", this.url, ["Accept: application/sdp"]);
    const track = backchannelTrack(sdp);
    if (!track) throw new Error("Kamera bietet keinen Audio-Rückkanal an");
    const trackUrl = track.startsWith("rtsp://") ? track : `${this.url}/${track}`;

    const setup = await this.request("SETUP", trackUrl, ["Transport: RTP/AVP/TCP;unicast;interleaved=0-1"]);
    this.session = /Session:\s*([^;\r\n]+)/i.exec(setup)?.[1]?.trim() ?? null;
    // Reolink kennt kein RECORD – PLAY schaltet den Rückkanal frei.
    await this.request("PLAY", this.url, ["Range: npt=0.000-"]);
  }

  /** PCMU in RTP-Paketen senden, im Tempo der Wiedergabe. */
  async send(audio: Buffer): Promise<void> {
    const sock = this.sock;
    if (!sock) throw new Error("RTSP nicht verbunden");
    const ssrc = Math.floor(Math.random() * 0xffffffff) >>> 0;
    let seq = Math.floor(Math.random() * 0xffff);
    let timestamp = 0;
    const startedAt = Date.now();

    for (let offset = 0, packet = 0; offset < audio.length; offset += PACKET_BYTES, packet++) {
      const slice = audio.subarray(offset, offset + PACKET_BYTES);
      const rtp = Buffer.alloc(12 + slice.length);
      rtp[0] = 0x80; // Version 2, keine Erweiterungen.
      rtp[1] = 0x00; // Payload-Typ 0 = PCMU.
      seq = (seq + 1) & 0xffff;
      rtp.writeUInt16BE(seq, 2);
      rtp.writeUInt32BE(timestamp, 4);
      rtp.writeUInt32BE(ssrc, 8);
      slice.copy(rtp, 12);
      timestamp = (timestamp + slice.length) >>> 0;

      // RTP über TCP wird in "$"-Rahmen verpackt (RFC 2326, interleaved).
      const framed = Buffer.alloc(4 + rtp.length);
      framed[0] = 0x24;
      framed[1] = 0x00;
      framed.writeUInt16BE(rtp.length, 2);
      rtp.copy(framed, 4);
      if (!sock.write(framed)) {
        await new Promise<void>((resolve) => sock.once("drain", resolve));
      }

      // Absolute Zeitplanung, damit sich der Takt nicht aufsummiert.
      const wait = startedAt + (packet + 1) * PACKET_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  async close(): Promise<void> {
    try {
      if (this.session) await this.request("TEARDOWN", this.url);
    } catch {
      // Beim Aufräumen ist ein Fehler belanglos.
    }
    this.sock?.destroy();
    this.sock = null;
  }
}

/** Im SDP den Audio-Abschnitt mit `a=sendonly` finden – das ist der Rückkanal. */
function backchannelTrack(sdp: string): string | null {
  let track: string | null = null;
  for (const block of sdp.split(/\r?\nm=/).slice(1)) {
    if (!block.startsWith("audio") || !/a=sendonly/.test(block)) continue;
    track = /a=control:(\S+)/.exec(block)?.[1] ?? null;
  }
  return track;
}

/* ---------------------------------------------------------------------------
 * Öffentliche Schnittstelle
 * ------------------------------------------------------------------------- */

/**
 * Ansage über den Kamera-Lautsprecher. Läuft eine Ansage auf derselben
 * Kamera, wartet diese – Stimmen sollen sich nicht überlagern.
 */
export async function speakOnCamera(
  target: TalkTarget,
  text: string,
  opts: { voice?: string } = {},
): Promise<{ seconds: number }> {
  const label = target.label ?? target.host;
  const previous = busy.get(target.host);
  if (previous) await previous.catch(() => {});

  let done: () => void = () => {};
  busy.set(target.host, new Promise<void>((resolve) => (done = resolve)));
  try {
    const audio = await renderSpeech(text, opts.voice ?? VOICE);
    const maxBytes = MAX_SECONDS * SAMPLE_RATE;
    const payload = audio.length > maxBytes ? audio.subarray(0, maxBytes) : audio;
    const seconds = payload.length / SAMPLE_RATE;

    const talk = new RtspTalk(target);
    try {
      await talk.connect();
      await talk.open();
      await talk.send(payload);
    } finally {
      await talk.close();
    }
    log(`Ansage ${label}: "${text}" (${seconds.toFixed(1)} s)`);
    improve("camera", "talk_ok", { cam: label, seconds });
    return { seconds };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log(`Ansage ${label} fehlgeschlagen: ${detail}`);
    improve("camera", "talk_fail", { cam: label, error: detail });
    throw err;
  } finally {
    busy.delete(target.host);
    done();
  }
}
