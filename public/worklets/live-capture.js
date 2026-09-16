/**
 * AudioWorklet der Live-Durchsage: sammelt den Mikrofonton und reicht ihn in
 * Blöcken von 100 ms an die Seite weiter. Heruntergerechnet und verschickt wird
 * dort (src/lib/audio-live.ts) – hier läuft nur, was im Audio-Thread sein muss.
 *
 * Liegt als statische Datei vor, weil Safari Worklets aus Blob-URLs nicht
 * zuverlässig lädt.
 */
class EmpLiveCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 10);
    this.buffer = new Float32Array(this.size);
    this.length = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    let offset = 0;
    while (offset < channel.length) {
      const count = Math.min(channel.length - offset, this.size - this.length);
      this.buffer.set(channel.subarray(offset, offset + count), this.length);
      this.length += count;
      offset += count;
      if (this.length === this.size) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(this.size);
        this.length = 0;
      }
    }
    // Ausgang bleibt stumm: der Sprecher soll sich nicht selbst hören.
    return true;
  }
}

registerProcessor("emp-live-capture", EmpLiveCapture);
