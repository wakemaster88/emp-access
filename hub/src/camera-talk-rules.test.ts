import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import {
  DRAIN_WAIT_MS,
  SPEECH_TOOL_TIMEOUT_MS,
  TALK_GRACE_MS,
  TalkQueue,
  rtpFrame,
  sendPcmu,
  sinkOpen,
  talkDeadlineMs,
  waitForDrain,
  withDeadline,
  type PacketSink,
} from "./camera-talk-rules.js";

const PACKET = { packetBytes: 160, packetMs: 20 };

test("talkDeadlineMs: Länge der Ansage plus 10 s", () => {
  assert.equal(TALK_GRACE_MS, 10_000);
  assert.equal(talkDeadlineMs(4.7), 14_700);
  assert.equal(talkDeadlineMs(30), 40_000);
  assert.equal(talkDeadlineMs(0), 10_000);
  assert.equal(talkDeadlineMs(Number.NaN), 10_000);
  assert.equal(DRAIN_WAIT_MS, 5_000);
  // Sprachausgabe (say, afconvert) mit Zeitlimit 15 s.
  assert.equal(SPEECH_TOOL_TIMEOUT_MS, 15_000);
});

test("rtpFrame: $-Rahmen, RTP-Kopf mit PCMU, Folgenummer, Zeitstempel und Quelle", () => {
  const f = rtpFrame(Buffer.from([1, 2, 3]), 0x1234, 160, 0xdeadbeef);
  assert.deepEqual([...f.subarray(0, 4)], [0x24, 0x00, 0x00, 15]);
  assert.deepEqual([f[4], f[5]], [0x80, 0x00]);
  assert.equal(f.readUInt16BE(6), 0x1234);
  assert.equal(f.readUInt32BE(8), 160);
  assert.equal(f.readUInt32BE(12), 0xdeadbeef);
  assert.deepEqual([...f.subarray(16)], [1, 2, 3]);
});

/** Attrappe einer Verbindung: nimmt `accept` Pakete an, danach meldet write „voll“. */
class FakeSink extends EventEmitter implements PacketSink {
  destroyed = false;
  writableEnded = false;
  written = 0;
  constructor(private readonly accept: number) {
    super();
  }
  write(): boolean {
    if (this.destroyed) return false;
    this.written++;
    return this.written < this.accept;
  }
}

test("sendPcmu: alle Pakete im Takt, wenn die Verbindung Daten annimmt", async () => {
  const sink = new FakeSink(Infinity);
  let clock = 0;
  const waits: number[] = [];
  const res = await sendPcmu(sink, Buffer.alloc(800), {
    ...PACKET,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    ssrc: 1,
    seq: 0,
  });
  assert.equal(res.packets, 5);
  assert.deepEqual(waits, [20, 20, 20, 20, 20]);
});

test("sendPcmu: Verbindung bricht mitten im Senden ab – Fehler statt ewigem Warten auf drain", async () => {
  const sink = new FakeSink(10);
  const started = Date.now();
  const sending = sendPcmu(sink, Buffer.alloc(160 * 100), { ...PACKET, sleep: async () => {} });
  // Nach dem 10. Paket ist der Puffer voll; dann trennt die Kamera.
  setTimeout(() => {
    sink.destroyed = true;
    sink.emit("close");
  }, 30);
  await assert.rejects(sending, /Verbindung zur Kamera beendet/);
  assert.equal(sink.written, 10);
  assert.ok(Date.now() - started < 1_000);
  assert.equal(sink.listenerCount("drain") + sink.listenerCount("close") + sink.listenerCount("error"), 0);
});

test("sendPcmu: schon getrennte Verbindung wird vor dem Schreiben erkannt", async () => {
  const sink = new FakeSink(Infinity);
  let n = 0;
  const sending = sendPcmu(sink, Buffer.alloc(160 * 5), {
    ...PACKET,
    sleep: async () => {
      if (++n === 2) sink.writableEnded = true;
    },
  });
  await assert.rejects(sending, /beendet/);
  assert.equal(sink.written, 2);
});

test("waitForDrain: Fehler der Verbindung und Frist beenden das Warten", async () => {
  const sink = new FakeSink(0);
  const failing = waitForDrain(sink, 5_000);
  sink.emit("error", new Error("ECONNRESET"));
  await assert.rejects(failing, /ECONNRESET/);

  const t0 = Date.now();
  await assert.rejects(waitForDrain(new FakeSink(0), 50), /nimmt keine Daten an/);
  assert.ok(Date.now() - t0 < 1_000);

  const ok = waitForDrain(sink, 5_000);
  sink.emit("drain");
  await ok;
  assert.equal(sinkOpen(sink), true);
});

/**
 * Wie im Betrieb: lokaler Server als Kamera, der die Verbindung nach 100 ms
 * schließt (FIN) oder zurücksetzt (RST). Ohne Prüfung vor dem Schreiben und
 * ohne Blick auf close/error blieb die Schleife hier im Warten auf drain
 * stehen.
 */
for (const mode of ["fin", "rst"] as const) {
  test(`sendPcmu: echte Verbindung, Kamera trennt mitten in der Ansage (${mode})`, async () => {
    const server = net.createServer((s) => {
      s.on("error", () => {});
      setTimeout(() => (mode === "rst" ? s.resetAndDestroy() : s.destroy()), 100);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    const sock = net.createConnection({ host: "127.0.0.1", port });
    sock.on("error", () => {});
    await new Promise<void>((resolve) => sock.once("connect", () => resolve()));
    try {
      const started = Date.now();
      // 2 s Audio, die Verbindung endet nach 100 ms.
      await assert.rejects(sendPcmu(sock, Buffer.alloc(160 * 100), PACKET));
      assert.ok(Date.now() - started < 2_000, "endet vor dem Ende der Ansage");
    } finally {
      sock.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

test("withDeadline: nach der Frist Aufräumen und Fehler, ein spätes Ende wird verworfen", async () => {
  let cleaned = 0;
  let finish: () => void = () => {};
  const slow = new Promise<string>((resolve) => (finish = () => resolve("spät")));
  await assert.rejects(withDeadline(slow, 30, () => cleaned++, "Gesamtfrist"), /Gesamtfrist überschritten/);
  assert.equal(cleaned, 1);
  finish();
  assert.equal(await withDeadline(Promise.resolve(7), 1_000, () => cleaned++), 7);
  await assert.rejects(withDeadline(Promise.reject(new Error("RTSP-Timeout")), 1_000, () => cleaned++), /RTSP-Timeout/);
  assert.equal(cleaned, 1);
});

test("TalkQueue: je Kamera eine Ansage nach der anderen, eine gescheiterte hält die nächste nicht auf", async () => {
  const q = new TalkQueue();
  const events: string[] = [];
  const job = (name: string, ms: number, fail = false) => async () => {
    events.push(`start ${name}`);
    await new Promise((r) => setTimeout(r, ms));
    events.push(`ende ${name}`);
    if (fail) throw new Error(name);
    return name;
  };
  const a = q.run("10.0.0.9", job("a", 30));
  const b = q.run("10.0.0.9", job("b", 10, true));
  const c = q.run("10.0.0.9", job("c", 5));
  const other = q.run("10.0.0.7", job("x", 5));
  assert.equal(q.pending("10.0.0.9"), 3);
  assert.equal(await a, "a");
  await assert.rejects(b, /b/);
  assert.equal(await c, "c");
  assert.equal(await other, "x");
  const mine = events.filter((e) => !e.endsWith(" x"));
  assert.deepEqual(mine, ["start a", "ende a", "start b", "ende b", "start c", "ende c"]);
  // Die andere Kamera wartet nicht auf diese.
  assert.ok(events.indexOf("start x") < events.indexOf("ende a"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(q.pending("10.0.0.9"), 0);
});

test("TalkQueue: drei gleichzeitige Aufrufe starten nie gleichzeitig", async () => {
  const q = new TalkQueue();
  let running = 0;
  let most = 0;
  const job = async () => {
    running++;
    most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
  };
  await Promise.all([q.run("cam", job), q.run("cam", job), q.run("cam", job)]);
  assert.equal(most, 1);
});

test("TalkQueue.total: laufende und wartende Ansagen ueber alle Kameras", async () => {
  const q = new TalkQueue();
  assert.equal(q.total(), 0);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const jobs = [q.run("a", () => gate), q.run("a", async () => undefined), q.run("b", () => gate)];
  assert.equal(q.total(), 3);
  release();
  await Promise.all(jobs);
  await new Promise((r) => setImmediate(r));
  assert.equal(q.total(), 0);
});
