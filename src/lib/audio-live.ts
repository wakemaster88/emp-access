/**
 * Live-Durchsage: gemeinsame Konstanten und reine Hilfsfunktionen für Browser,
 * API und Tests – ohne Server-Importe.
 *
 * Ablauf: Der Browser nimmt das Mikrofon auf, rechnet es auf 16 kHz mono
 * herunter und schickt es alle paar hundert Millisekunden als rohes PCM
 * (16 Bit little-endian) an die Cloud. Die Zonen-Pis holen die Stücke
 * fortlaufend ab und spielen sie sofort ab. Kein Codec, kein Container: ein Pi,
 * der später dazukommt, steigt einfach beim neuesten Stück ein.
 */

/** Sprache braucht nicht mehr; 16 kHz mono sind 32 KB pro Sekunde. */
export const LIVE_SAMPLE_RATE = 16_000;

/** Bytes pro Sekunde Ton (16 Bit mono). */
export const LIVE_BYTES_PER_SECOND = LIVE_SAMPLE_RATE * 2;

/**
 * So viel Ton sammelt der Browser, bevor er ihn abschickt. Weniger drückt die
 * Verzögerung kaum, verdoppelt aber die Anfragen.
 */
export const LIVE_SEND_INTERVAL_MS = 400;

/**
 * Staut sich im Browser mehr als das (langsames Netz), fällt das Älteste weg –
 * eine Durchsage, die immer weiter hinterherläuft, hilft niemandem.
 */
export const LIVE_MAX_BACKLOG_MS = 4_000;

/** Obergrenze für ein einzelnes Stück (8 s Ton). */
export const LIVE_MAX_CHUNK_BYTES = 8 * LIVE_BYTES_PER_SECOND;

/**
 * Kommt so lange kein Ton mehr an, gilt die Sitzung als beendet: der Tab wurde
 * geschlossen, das Handy gesperrt oder das Netz ist weg. Ohne diese Grenze
 * hingen die Zonen an einer Durchsage, die niemand mehr beenden kann.
 */
export const LIVE_STALE_AFTER_MS = 15_000;

/** Stücke, die der Server vorhält – gut 20 Sekunden, ältere holt kein Pi mehr. */
export const LIVE_KEEP_CHUNKS = 50;

export type LiveSessionState = "LIVE" | "ENDED";

/** Läuft die Sitzung noch? Beendet ist sie ausdrücklich oder durch Schweigen. */
export function isLiveSessionOpen(
  session: { status: string; lastChunkAt: Date | null; startedAt: Date },
  now: Date
): boolean {
  if (session.status !== "LIVE") return false;
  const lastSign = session.lastChunkAt ?? session.startedAt;
  return now.getTime() - lastSign.getTime() < LIVE_STALE_AFTER_MS;
}

/**
 * Rechnet den Mikrofonton fortlaufend auf die Zielrate herunter.
 *
 * Jedes Ausgabesample ist der Mittelwert der Eingangssamples seines Fensters.
 * Das filtert zugleich grob gegen Aliasing; den Rest übernimmt ein Tiefpass vor
 * der Aufnahme. Der Bruchteil zwischen zwei Fenstern bleibt über Aufrufe
 * erhalten, sonst liefe die Ausgaberate bei 44,1 kHz langsam davon.
 */
export class PcmDownsampler {
  private readonly step: number;
  private sum = 0;
  private count = 0;
  private position = 0;
  private last = 0;

  constructor(inputRate: number, outputRate: number = LIVE_SAMPLE_RATE) {
    if (!(inputRate > 0) || !(outputRate > 0)) {
      throw new Error("Abtastraten müssen positiv sein");
    }
    this.step = inputRate / outputRate;
  }

  /** Nimmt Float-Samples (−1…1) und gibt fertige 16-Bit-Samples zurück. */
  push(input: Float32Array): Int16Array {
    const out = new Int16Array(Math.ceil((this.position + input.length) / this.step) + 1);
    let written = 0;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      this.count += 1;
      this.position += 1;
      if (this.position < this.step) continue;

      if (this.count > 0) {
        this.last = this.sum / this.count;
        this.sum = 0;
        this.count = 0;
      }
      // Liegt die Eingangsrate unter der Zielrate, fallen mehrere Ausgabesamples
      // auf ein Eingangssample – dann wird es wiederholt.
      while (this.position >= this.step) {
        this.position -= this.step;
        out[written++] = toInt16(this.last);
      }
    }
    return out.subarray(0, written);
  }
}

function toInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
}

/** 16-Bit-Samples als little-endian Bytes, unabhängig von der Plattform. */
export function int16ToLittleEndian(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true);
  return bytes;
}

/** Pegel für die Aussteuerungsanzeige: 0 (unter −60 dBFS) bis 1 (Vollaussteuerung). */
export function meterLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  const rms = Math.sqrt(energy / samples.length);
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 60) / 60));
}
