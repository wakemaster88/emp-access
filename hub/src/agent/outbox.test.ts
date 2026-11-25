import { test } from "node:test";
import assert from "node:assert/strict";
import { Outbox, type OutMessage } from "./outbox.js";
import { CLOSED_PHOTO_NOTE, MAX_WAITING, imageSilent, type OutResult } from "./outbox-rules.js";

const SEC = 1000;
const MIN = 60 * SEC;
const T0 = 1_000_000;

/** Uhr zum Vorstellen: Wer wartet, wird geweckt, sobald die Zeit so weit ist. */
class Clock {
  now = T0;
  private timers: { at: number; wake: () => void }[] = [];

  sleep = (ms: number): Promise<void> =>
    new Promise((wake) => {
      this.timers.push({ at: this.now + ms, wake });
    });

  /** Laesst die Zeit laufen, bis niemand mehr wartet (oder bis `untilSec` Sekunden nach dem Start). */
  async run(untilSec = Infinity): Promise<void> {
    const until = T0 + untilSec * SEC;
    for (;;) {
      await idle();
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > until) break;
      this.timers.shift();
      this.now = Math.max(this.now, next.at);
      next.wake();
    }
    if (Number.isFinite(until)) this.now = Math.max(this.now, until);
  }
}

/** Alles abarbeiten lassen, was ohne Wartezeit weiterlaufen kann. */
const idle = async () => {
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r));
};

const netz = () => new TypeError("fetch failed");
const timeout = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");
/** Fehler, wie telegram.ts ihn wirft, wenn Telegram mit einem Fehler antwortet. */
const http = (status: number, text: string, retryAfterSec: number | null = null) =>
  Object.assign(new Error(`Telegram: ${text}`), { status, retryAfterSec });

type Step = "ok" | (() => unknown);
type Script = Step[] | ((chatId: string) => Step);

interface Call {
  kind: "foto" | "text";
  chatId: string;
  text: string;
  buttons: unknown;
  /** Ohne Ton gesendet (disable_notification). */
  silent: boolean;
  /** Sekunden seit dem Start. */
  at: number;
}

interface Meta {
  name: string;
}

/**
 * Sender-Attrappe: `foto` und `text` sagen der Reihe nach, wie jeder Versuch
 * ausgeht ("ok" oder ein Fehler); ist die Liste zu Ende, gelingt jeder weitere.
 * `takesMs` ist die Dauer eines Versuchs.
 */
function setup(o: { foto?: Script; text?: Script; takesMs?: number; onResult?: (msg: OutMessage<Meta>, r: OutResult) => void } = {}) {
  const clock = new Clock();
  const calls: Call[] = [];
  const results: { name: string; result: OutResult }[] = [];
  const errors: unknown[] = [];
  const left = { foto: Array.isArray(o.foto) ? [...o.foto] : [], text: Array.isArray(o.text) ? [...o.text] : [] };
  const send = async (kind: "foto" | "text", chatId: string, text: string, buttons: unknown, opts?: { silent?: boolean }) => {
    calls.push({ kind, chatId, text, buttons, silent: opts?.silent === true, at: (clock.now - T0) / SEC });
    const script = kind === "foto" ? o.foto : o.text;
    const step = typeof script === "function" ? script(chatId) : (left[kind].shift() ?? "ok");
    if (o.takesMs) await clock.sleep(o.takesMs);
    if (step !== "ok") throw step();
  };
  const outbox = new Outbox<Meta>({
    photo: (chatId, _jpeg, caption, buttons, opts) => send("foto", chatId, caption, buttons, opts),
    text: (chatId, text, buttons, opts) => send("text", chatId, text, buttons, opts),
    now: () => clock.now,
    sleep: clock.sleep,
    onResult:
      o.onResult ??
      ((msg, result) => {
        results.push({ name: msg.meta.name, result });
      }),
    onError: (e) => errors.push(e),
  });
  return { clock, calls, results, errors, outbox };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const BUTTONS = [[{ text: "💡 Licht an", callback_data: "sl:1:on" }], [{ text: "✓ Ist in Ordnung", callback_data: "sk:1" }]];
const NOTE = "\nBild nicht übertragen, es steht in der Zentrale unter KI.";

const alarm = (chatId = "c1", name = "Alarm"): OutMessage<Meta> => ({
  chatId,
  text: "⚠️ Eingang: Person am Tor",
  jpeg: JPEG,
  buttons: BUTTONS,
  textFallback: { note: NOTE },
  meta: { name },
});
const image = (name: string, chatId = "c1", silent?: OutMessage["silent"]): OutMessage<Meta> => ({
  chatId,
  text: `Eingang · ${name}`,
  jpeg: JPEG,
  optional: true,
  ...(silent !== undefined ? { silent } : {}),
  meta: { name },
});
const notice = (name = "Meldung", chatId = "c1"): OutMessage<Meta> => ({ chatId, text: "⚠️ Kamera Eingang nicht erreichbar", meta: { name } });

const times = (calls: Call[]) => calls.map((c) => c.at);
const kinds = (calls: Call[]) => calls.map((c) => c.kind);

/* ------------------------------------------------------------ Wiederholen */

test("Fehler, Fehler, Erfolg: genau eine Zustellung, Versuche bei 0, 5 und 25 s", async () => {
  const s = setup({ foto: [netz, netz, "ok"] });
  const done = s.outbox.enqueue(alarm());
  await s.clock.run();
  assert.deepEqual(await done, { ok: true, tries: 3, ms: 25 * SEC, asText: false, photoError: null });
  assert.deepEqual(times(s.calls), [0, 5, 25]);
  assert.deepEqual(kinds(s.calls), ["foto", "foto", "foto"]);
  // Jeder Versuch mit demselben Inhalt: Text, Knoepfe.
  for (const c of s.calls) {
    assert.equal(c.text, "⚠️ Eingang: Person am Tor");
    assert.equal(c.buttons, BUTTONS);
  }
  assert.equal(s.results.length, 1);
  assert.equal(s.outbox.pending(), 0);
});

test("Nach dem Erfolg kein zweiter Versand", async () => {
  const s = setup();
  const done = s.outbox.enqueue(alarm());
  await s.clock.run();
  assert.deepEqual(await done, { ok: true, tries: 1, ms: 0, asText: false, photoError: null });
  await s.clock.run(60 * 60);
  assert.equal(s.calls.length, 1);
  assert.equal(s.results.length, 1);
  assert.equal(s.outbox.pending(), 0);
  assert.deepEqual(s.errors, []);
});

test("Einreihen wartet nicht auf die Zustellung", async () => {
  const s = setup({ takesMs: 2 * SEC });
  let settled = false;
  const done = s.outbox.enqueue(alarm()).then((r) => {
    settled = true;
    return r;
  });
  await idle();
  assert.equal(settled, false);
  assert.equal(s.outbox.pending(), 1);
  await s.clock.run();
  assert.equal((await done).ok, true);
  assert.equal(settled, true);
});

test("429: der nächste Versuch wartet die Zeit ab, die Telegram nennt", async () => {
  const s = setup({ foto: [() => http(429, "Too Many Requests: retry after 35", 35), "ok"] });
  const done = s.outbox.enqueue(alarm());
  await s.clock.run();
  assert.deepEqual(times(s.calls), [0, 35]);
  assert.deepEqual(await done, { ok: true, tries: 2, ms: 35 * SEC, asText: false, photoError: null });
});

test("HTTP 5xx wird wiederholt", async () => {
  const s = setup({ text: [() => http(502, "Bad Gateway"), "ok"] });
  const done = s.outbox.enqueue(notice());
  await s.clock.run();
  assert.deepEqual(times(s.calls), [0, 5]);
  assert.equal((await done).ok, true);
});

/* ------------------------------------------------------------ Frist */

test("Verfall nach 15 Minuten: Versuche bei 0, 5, 25, 85, 265, 445, 625, 805 und 900 s, danach keiner", async () => {
  const s = setup({ foto: () => netz, text: () => netz });
  const done = s.outbox.enqueue(alarm());
  await s.clock.run();
  assert.deepEqual(times(s.calls), [0, 5, 25, 85, 265, 445, 625, 805, 900]);
  // Der letzte Versuch eines Alarms geht ohne Bild hinaus.
  assert.deepEqual(kinds(s.calls), ["foto", "foto", "foto", "foto", "foto", "foto", "foto", "foto", "text"]);
  assert.deepEqual(await done, { ok: false, tries: 9, ms: 15 * MIN, reason: "fetch failed", permanent: false });
  await s.clock.run(2 * 60 * 60);
  assert.equal(s.calls.length, 9);
  assert.equal(s.results.length, 1);
  assert.equal(s.outbox.pending(), 0);
});

test("Verfall nach 15 Minuten gilt auch für Text und Zusatzbild", async () => {
  const s = setup({ foto: () => netz, text: () => netz });
  const text = s.outbox.enqueue(notice("Meldung", "c1"));
  const bild = s.outbox.enqueue(image("Übersicht", "c2"));
  await s.clock.run();
  const c1 = s.calls.filter((c) => c.chatId === "c1");
  const c2 = s.calls.filter((c) => c.chatId === "c2");
  assert.deepEqual(times(c1), [0, 5, 25, 85, 265, 445, 625, 805, 900]);
  assert.deepEqual(times(c2), [0, 5, 25, 85, 265, 445, 625, 805, 900]);
  // Ein Zusatzbild geht nie als Text hinaus.
  assert.ok(c2.every((c) => c.kind === "foto"));
  assert.equal((await text).ok, false);
  assert.equal((await bild).ok, false);
});

test("Der letzte Versuch eines Alarms geht als Text mit Knöpfen hinaus und zählt als Zustellung", async () => {
  const s = setup({ foto: () => netz });
  const done = s.outbox.enqueue(alarm());
  await s.clock.run();
  assert.deepEqual(await done, { ok: true, tries: 9, ms: 15 * MIN, asText: true, photoError: "fetch failed" });
  const last = s.calls[s.calls.length - 1];
  assert.equal(last.kind, "text");
  assert.equal(last.at, 900);
  assert.equal(last.text, `⚠️ Eingang: Person am Tor${NOTE}`);
  assert.equal(last.buttons, BUTTONS);
});

test("Dauert jeder Versuch 60 s bis zur Zeitüberschreitung, beginnt keiner nach der Frist", async () => {
  const s = setup({ foto: () => timeout, text: () => timeout, takesMs: 60 * SEC });
  const done = s.outbox.enqueue(alarm());
  await s.clock.run();
  assert.deepEqual(times(s.calls), [0, 65, 145, 265, 505, 745, 900]);
  assert.equal(s.calls[s.calls.length - 1].kind, "text");
  assert.deepEqual(await done, { ok: false, tries: 7, ms: 16 * MIN, reason: "Zeitüberschreitung", permanent: false });
});

test("Läuft ein Versuch mit Bild über das Ende der Frist hinaus, geht der Alarm danach noch einmal als Text mit Knöpfen hinaus", async () => {
  // 45 s je Versuch: Der Versuch mit Bild von 895 s scheitert bei 940 s, also nach der Frist von 900 s.
  const s = setup({ foto: () => timeout, takesMs: 45 * SEC });
  const done = s.outbox.enqueue(alarm());
  await s.clock.run();
  assert.deepEqual(times(s.calls), [0, 50, 115, 220, 445, 670, 895, 940]);
  assert.deepEqual(kinds(s.calls), ["foto", "foto", "foto", "foto", "foto", "foto", "foto", "text"]);
  const last = s.calls[s.calls.length - 1];
  assert.equal(last.text, `⚠️ Eingang: Person am Tor${NOTE}`);
  assert.equal(last.buttons, BUTTONS);
  assert.deepEqual(await done, { ok: true, tries: 8, ms: 985 * SEC, asText: true, photoError: "Zeitüberschreitung" });
  await s.clock.run(2 * 60 * 60);
  assert.equal(s.calls.length, 8);
  assert.equal(s.results.length, 1);
});

test("Scheitert auch dieser Versuch als Text, ist der Alarm nicht zugestellt und es folgt kein weiterer", async () => {
  const s = setup({ foto: () => timeout, text: () => timeout, takesMs: 45 * SEC });
  const done = s.outbox.enqueue(alarm());
  await s.clock.run();
  assert.deepEqual(times(s.calls), [0, 50, 115, 220, 445, 670, 895, 940]);
  assert.equal(s.calls[s.calls.length - 1].kind, "text");
  assert.deepEqual(await done, { ok: false, tries: 8, ms: 985 * SEC, reason: "Zeitüberschreitung", permanent: false });
  await s.clock.run(2 * 60 * 60);
  assert.equal(s.calls.length, 8);
  assert.equal(s.outbox.pending(), 0);
});

test("Ein Alarm, der hinter einer anderen Nachricht wartet und dessen Versuch mit Bild kurz vor seiner Frist beginnt, geht danach als Text hinaus", async () => {
  // Die Meldung davor scheitert 15 Minuten lang, jeder Versuch dauert 5 s; danach ist Telegram fuer Text wieder erreichbar.
  const s = setup({ foto: () => netz, text: [netz, netz, netz, netz, netz, netz, netz, netz, netz], takesMs: 5 * SEC });
  const meldung = s.outbox.enqueue(notice());
  await s.clock.run(8);
  const done = s.outbox.enqueue(alarm());
  await s.clock.run();
  assert.equal((await meldung).ok, false);
  const meldungen = s.calls.filter((c) => !c.text.startsWith("⚠️ Eingang"));
  const alarme = s.calls.filter((c) => c.text.startsWith("⚠️ Eingang"));
  assert.deepEqual(times(meldungen), [0, 10, 35, 100, 285, 470, 655, 840, 900]);
  // Die Frist des Alarms endet bei 908 s: Sein Versuch mit Bild beginnt bei 905 s und scheitert bei 910 s.
  assert.deepEqual(alarme.map((c) => `${c.at} ${c.kind}`), ["905 foto", "910 text"]);
  assert.equal(alarme[1].text, `⚠️ Eingang: Person am Tor${NOTE}`);
  assert.deepEqual(await done, { ok: true, tries: 2, ms: 907 * SEC, asText: true, photoError: "fetch failed" });
});

/* ------------------------------------------------------------ Ohne Bild */

test("Rückfall auf Text: lehnt Telegram das Bild ab, geht der Alarm sofort als Text mit Knöpfen hinaus", async () => {
  const s = setup({ foto: [() => http(400, "Bad Request: PHOTO_INVALID_DIMENSIONS")] });
  const done = s.outbox.enqueue(alarm());
  await s.clock.run();
  assert.deepEqual(kinds(s.calls), ["foto", "text"]);
  assert.deepEqual(times(s.calls), [0, 0]);
  assert.equal(s.calls[1].text, `⚠️ Eingang: Person am Tor${NOTE}`);
  assert.equal(s.calls[1].buttons, BUTTONS);
  assert.deepEqual(await done, {
    ok: true,
    tries: 2,
    ms: 0,
    asText: true,
    photoError: "Telegram: Bad Request: PHOTO_INVALID_DIMENSIONS",
  });
  // Danach nichts mehr, auch kein Bild.
  await s.clock.run(60 * 60);
  assert.equal(s.calls.length, 2);
});

test("Rückfall auf Text: der Text wird bei Netzfehlern nach Plan wiederholt, das Bild nicht mehr", async () => {
  const s = setup({ foto: [() => http(413, "Request Entity Too Large")], text: [netz, netz, "ok"] });
  const done = s.outbox.enqueue(alarm());
  await s.clock.run();
  assert.deepEqual(kinds(s.calls), ["foto", "text", "text", "text"]);
  assert.deepEqual(times(s.calls), [0, 0, 20, 80]);
  const r = await done;
  assert.equal(r.ok && r.asText, true);
  assert.equal(r.tries, 4);
});

test("Lehnt Telegram auch den Text ab, ist der Alarm nicht zustellbar", async () => {
  const s = setup({ foto: [() => http(400, "Bad Request: wrong file")], text: [() => http(403, "Forbidden: bot was blocked by the user")] });
  const done = s.outbox.enqueue(alarm());
  await s.clock.run();
  assert.deepEqual(kinds(s.calls), ["foto", "text"]);
  assert.deepEqual(await done, { ok: false, tries: 2, ms: 0, reason: "Telegram: Forbidden: bot was blocked by the user", permanent: true });
});

test("4xx auf einen Text: ein Versuch, nicht zustellbar", async () => {
  const s = setup({ text: [() => http(400, "Bad Request: chat not found")] });
  const done = s.outbox.enqueue(notice());
  await s.clock.run();
  assert.equal(s.calls.length, 1);
  assert.deepEqual(await done, { ok: false, tries: 1, ms: 0, reason: "Telegram: Bad Request: chat not found", permanent: true });
});

test("4xx auf ein Zusatzbild: aufgegeben, kein Text an seiner Stelle", async () => {
  const s = setup({ foto: [() => http(400, "Bad Request: wrong file")] });
  const done = s.outbox.enqueue(image("Übersicht"));
  await s.clock.run();
  assert.deepEqual(kinds(s.calls), ["foto"]);
  assert.equal((await done).ok, false);
});

/* ------------------------------------------------------------ Reihenfolge */

test("Reihenfolge: die Bilder eines Alarms gehen erst hinter ihm hinaus, in der Reihenfolge des Einreihens", async () => {
  const s = setup({ foto: [netz, netz, "ok"] });
  void s.outbox.enqueue(alarm());
  void s.outbox.enqueue(image("Übersicht"));
  void s.outbox.enqueue(image("+4 s"));
  void s.outbox.enqueue(image("+8 s"));
  await s.clock.run(20);
  // Solange der Alarm nicht angekommen ist, geht kein Bild hinaus.
  assert.equal(s.calls.length, 2);
  await s.clock.run();
  assert.deepEqual(
    s.calls.map((c) => `${c.at} ${c.text}`),
    [
      "0 ⚠️ Eingang: Person am Tor",
      "5 ⚠️ Eingang: Person am Tor",
      "25 ⚠️ Eingang: Person am Tor",
      "25 Eingang · Übersicht",
      "25 Eingang · +4 s",
      "25 Eingang · +8 s",
    ]
  );
  assert.deepEqual(
    s.results.map((r) => r.name),
    ["Alarm", "Übersicht", "+4 s", "+8 s"]
  );
});

test("Reihenfolge: ein aufgegebener Alarm hält die Nachrichten dahinter nicht fest", async () => {
  const s = setup({ foto: [() => http(400, "Bad Request")], text: [() => http(400, "Bad Request")] });
  const first = s.outbox.enqueue(alarm("c1", "Alarm 1"));
  const second = s.outbox.enqueue(notice("Meldung"));
  await s.clock.run();
  assert.equal((await first).ok, false);
  assert.equal((await second).ok, true);
  assert.deepEqual(kinds(s.calls), ["foto", "text", "text"]);
});

test("Ein Chat, der nicht erreichbar ist, hält die anderen nicht auf", async () => {
  const s = setup({ foto: (chatId) => (chatId === "c1" ? netz : "ok"), text: (chatId) => (chatId === "c1" ? netz : "ok") });
  const lost = s.outbox.enqueue(alarm("c1"));
  const fine = s.outbox.enqueue(alarm("c2"));
  await s.clock.run(1);
  assert.deepEqual(await fine, { ok: true, tries: 1, ms: 0, asText: false, photoError: null });
  assert.equal(s.outbox.pending(), 1);
  await s.clock.run();
  assert.equal((await lost).ok, false);
  assert.equal(s.calls.filter((c) => c.chatId === "c2").length, 1);
});

test("Volle Reihe: Zusatzbilder werden abgewiesen, Alarme und Meldungen nicht", async () => {
  const s = setup({ foto: () => netz, text: () => netz });
  for (let i = 0; i < MAX_WAITING; i++) void s.outbox.enqueue(notice(`Meldung ${i}`));
  await idle();
  const bild = await s.outbox.enqueue(image("Übersicht"));
  assert.deepEqual(bild, { ok: false, tries: 0, ms: 0, reason: `Warteschlange voll (${MAX_WAITING} Nachrichten warten)`, permanent: false });
  void s.outbox.enqueue(alarm());
  assert.equal(s.outbox.pending(), MAX_WAITING + 1);
  // Eine andere Reihe ist davon nicht betroffen.
  void s.outbox.enqueue(image("Übersicht", "c2"));
  assert.equal(s.outbox.pending(), MAX_WAITING + 2);
});

/* ------------------------------------------------------------ Ton */

test("Ton: der Alarm klingelt, Übersicht und Bildserie gehen ohne Ton hinaus, in derselben Reihenfolge", async () => {
  const s = setup();
  void s.outbox.enqueue(alarm());
  void s.outbox.enqueue(image("Übersicht", "c1", true));
  void s.outbox.enqueue(image("+4 s", "c1", true));
  await s.clock.run();
  assert.deepEqual(
    s.calls.map((c) => `${c.text} ${c.silent ? "still" : "Ton"}`),
    ["⚠️ Eingang: Person am Tor Ton", "Eingang · Übersicht still", "Eingang · +4 s still"]
  );
});

test("Ton: eine stille Nachricht bleibt bei jeder Wiederholung still", async () => {
  const s = setup({ foto: [netz, netz, "ok"] });
  const done = s.outbox.enqueue(image("Übersicht", "c1", true));
  await s.clock.run();
  assert.deepEqual(times(s.calls), [0, 5, 25]);
  assert.ok(s.calls.every((c) => c.silent));
  assert.equal((await done).ok, true);
});

test("Ton: still als Text ohne Bild und beim letzten Versuch beim Beenden", async () => {
  const s = setup({ foto: [() => http(400, "Bad Request: wrong file")] });
  const silentAlarm = { ...alarm(), silent: true };
  void s.outbox.enqueue(silentAlarm);
  await s.clock.run();
  assert.deepEqual(kinds(s.calls), ["foto", "text"]);
  assert.ok(s.calls.every((c) => c.silent));

  const t = setup({ foto: () => netz });
  void t.outbox.enqueue(silentAlarm);
  await t.clock.run(10);
  await t.outbox.close();
  assert.equal(t.calls[t.calls.length - 1].kind, "text");
  assert.ok(t.calls.every((c) => c.silent));
});

test("Ton: eine Funktion wird vor jedem Versuch gefragt, scheitert sie, kommt die Nachricht mit Ton", async () => {
  const s = setup({ foto: [netz, "ok"] });
  let quiet = false;
  void s.outbox.enqueue(image("Übersicht", "c1", () => quiet));
  await s.clock.run(1);
  quiet = true;
  await s.clock.run();
  assert.deepEqual(
    s.calls.map((c) => c.silent),
    [false, true]
  );

  const t = setup();
  void t.outbox.enqueue(
    image("Übersicht", "c1", () => {
      throw new Error("kaputt");
    })
  );
  await t.clock.run();
  assert.deepEqual(
    t.calls.map((c) => c.silent),
    [false]
  );
  assert.deepEqual(t.errors, []);
});

test("Ton: Nachrichten ohne Angabe klingeln wie bisher", async () => {
  const s = setup();
  void s.outbox.enqueue(notice());
  void s.outbox.enqueue(image("Übersicht"));
  await s.clock.run();
  assert.ok(s.calls.every((c) => !c.silent));
});

test("Ton: ein Zusatzbild fragt erst, wenn der Alarm davor verbucht ist", async () => {
  // Wie dispatch.ts: Der Ausgang des Alarms wird beim Verbuchen gemerkt, das Bild richtet sich danach.
  const reached = new Map<string, boolean>();
  const s = setup({
    foto: (chatId) => (chatId === "c2" ? () => http(403, "Forbidden: bot was blocked by the user") : "ok"),
    text: (chatId) => (chatId === "c2" ? () => http(403, "Forbidden: bot was blocked by the user") : "ok"),
    onResult: (msg, r) => {
      if (msg.meta.name === "Alarm") reached.set(msg.chatId, r.ok);
    },
  });
  const silentIfReached = (chatId: string) => () => reached.get(chatId) !== false;
  for (const chatId of ["c1", "c2"]) {
    void s.outbox.enqueue(alarm(chatId));
    void s.outbox.enqueue(image("Übersicht", chatId, silentIfReached(chatId)));
  }
  await s.clock.run();
  const bild = (chatId: string) => s.calls.find((c) => c.chatId === chatId && c.text === "Eingang · Übersicht");
  assert.equal(bild("c1")?.silent, true);
  // Den Alarm hat c2 nicht bekommen: Das Bild ist dort die erste Nachricht des Alarms und kommt mit Ton.
  assert.equal(bild("c2")?.silent, false);
});

test("Ton: Ist der Alarm in einem Chat gescheitert, klingelt dort nur das erste Zusatzbild, das ankommt", async () => {
  // Wie dispatch.ts: Ausgang des Alarms je Chat, und ob ein Bild des Alarms dort schon mit Ton ankam.
  const reached = new Map<string, boolean>();
  const rang = new Set<string>();
  const loud = new Map<OutMessage<Meta>, boolean>();
  // In c2 scheitern der Alarm (Bild und Text) und die Übersicht; die Folgebilder kommen an.
  const fails = ["⚠️ Eingang: Person am Tor", "Eingang · Übersicht"];
  const s = setup({
    foto: (chatId) => (chatId === "c2" && fails.some((t) => s.calls[s.calls.length - 1].text.startsWith(t)) ? () => http(400, "Bad Request: wrong file") : "ok"),
    text: (chatId) => (chatId === "c2" ? () => http(400, "Bad Request: chat not found") : "ok"),
    onResult: (msg, r) => {
      if (msg.meta.name === "Alarm") reached.set(msg.chatId, r.ok);
      else if (r.ok && loud.get(msg)) rang.add(msg.chatId);
    },
  });
  const extra = (name: string, chatId: string) => {
    const msg: OutMessage<Meta> = image(name, chatId, () => {
      const silent = imageSilent(reached.get(chatId) ?? null, rang.has(chatId));
      loud.set(msg, !silent);
      return silent;
    });
    return msg;
  };
  for (const chatId of ["c1", "c2"]) {
    void s.outbox.enqueue(alarm(chatId));
    for (const name of ["Übersicht", "+4 s", "+8 s"]) void s.outbox.enqueue(extra(name, chatId));
  }
  await s.clock.run();
  const ton = (chatId: string) => s.calls.filter((c) => c.chatId === chatId).map((c) => `${c.kind} ${c.text.split("\n")[0]}${c.silent ? "" : " (Ton)"}`);
  assert.deepEqual(ton("c1"), ["foto ⚠️ Eingang: Person am Tor (Ton)", "foto Eingang · Übersicht", "foto Eingang · +4 s", "foto Eingang · +8 s"]);
  // c2: Der Alarm kam nicht an, die Übersicht mit Ton auch nicht. Es klingelt „+4 s“, „+8 s“ kommt still.
  assert.deepEqual(ton("c2"), [
    "foto ⚠️ Eingang: Person am Tor (Ton)",
    "text ⚠️ Eingang: Person am Tor (Ton)",
    "foto Eingang · Übersicht (Ton)",
    "foto Eingang · +4 s (Ton)",
    "foto Eingang · +8 s",
  ]);
});

/* ------------------------------------------------------------ Knöpfe mit Zeitpunkt */

test("Knöpfe als Funktion: jeder Versuch bekommt seinen Zeitpunkt, auch als Text ohne Bild", async () => {
  const s = setup({ foto: [netz, () => http(400, "Bad Request: wrong file")] });
  const stamped = (at: number) => [[{ text: "Licht an", callback_data: `cam:9:spot:${Math.floor((at - T0) / SEC)}` }]];
  const done = s.outbox.enqueue({ ...alarm(), buttons: stamped });
  await s.clock.run();
  assert.deepEqual(
    s.calls.map((c) => `${c.at} ${c.kind} ${(c.buttons as { callback_data: string }[][])[0][0].callback_data}`),
    ["0 foto cam:9:spot:0", "5 foto cam:9:spot:5", "5 text cam:9:spot:5"]
  );
  assert.equal((await done).ok, true);
});

test("Knöpfe als Funktion: scheitert sie, geht die Nachricht ohne Knöpfe hinaus", async () => {
  const s = setup();
  const done = s.outbox.enqueue({
    ...alarm(),
    buttons: () => {
      throw new Error("kaputt");
    },
  });
  await s.clock.run();
  assert.equal((await done).ok, true);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].buttons, undefined);
  assert.equal(s.errors.length, 1);
});

/* ------------------------------------------------------------ Beenden */

test("Beenden: ein wartender Alarm geht ein letztes Mal als Text hinaus, danach kein Versuch mehr", async () => {
  const s = setup({ foto: () => netz });
  const done = s.outbox.enqueue(alarm());
  await s.clock.run(10);
  assert.deepEqual(times(s.calls), [0, 5]);
  await s.outbox.close();
  const last = s.calls[s.calls.length - 1];
  assert.equal(last.kind, "text");
  assert.equal(last.text, `⚠️ Eingang: Person am Tor${CLOSED_PHOTO_NOTE}`);
  assert.equal(last.buttons, BUTTONS);
  assert.deepEqual(await done, { ok: true, tries: 3, ms: 10 * SEC, asText: true, photoError: "fetch failed" });
  await s.clock.run();
  assert.equal(s.calls.length, 3);
  assert.equal(s.results.length, 1);
  assert.equal(s.outbox.pending(), 0);
  assert.deepEqual(s.errors, []);
});

test("Beenden: scheitert auch der letzte Versuch, gilt der Alarm als nicht zugestellt", async () => {
  const s = setup({ foto: () => netz, text: () => netz });
  const done = s.outbox.enqueue(alarm());
  await s.clock.run(10);
  await s.outbox.close();
  assert.deepEqual(await done, { ok: false, tries: 3, ms: 10 * SEC, reason: "fetch failed (Hub wird beendet)", permanent: false });
  await s.clock.run();
  assert.equal(s.calls.length, 3);
  assert.equal(s.results.length, 1);
});

test("Beenden: wartende Texte und Zusatzbilder gelten als nicht zugestellt, Alarme dahinter gehen als Text hinaus", async () => {
  const s = setup({ foto: [netz], text: [netz] });
  const meldung = s.outbox.enqueue(notice());
  const bild = s.outbox.enqueue(image("Übersicht"));
  const zweiter = s.outbox.enqueue(alarm("c1", "Alarm 2"));
  await s.clock.run(1);
  assert.equal(s.calls.length, 1);
  await s.outbox.close();
  assert.deepEqual(await meldung, { ok: false, tries: 1, ms: 1 * SEC, reason: "Hub wird beendet", permanent: false });
  assert.deepEqual(await bild, { ok: false, tries: 0, ms: 1 * SEC, reason: "Hub wird beendet", permanent: false });
  assert.deepEqual(await zweiter, { ok: true, tries: 1, ms: 1 * SEC, asText: true, photoError: "Hub wird beendet" });
  assert.deepEqual(kinds(s.calls), ["text", "text"]);
  await s.clock.run();
  assert.equal(s.calls.length, 2);
  assert.equal(s.results.length, 3);
});

test("Beenden: ein laufender Versuch wird abgewartet und meldet seinen Ausgang selbst", async () => {
  const s = setup({ takesMs: 2 * SEC });
  const done = s.outbox.enqueue(alarm());
  await idle();
  let closed = false;
  const closing = s.outbox.close().then(() => {
    closed = true;
  });
  await idle();
  assert.equal(closed, false);
  await s.clock.run();
  await closing;
  assert.deepEqual(await done, { ok: true, tries: 1, ms: 2 * SEC, asText: false, photoError: null });
  assert.deepEqual(kinds(s.calls), ["foto"]);
  assert.equal(s.results.length, 1);
});

test("Beenden: scheitert der laufende Versuch mit Bild, geht der Alarm noch einmal als Text hinaus", async () => {
  const s = setup({ foto: [netz], takesMs: 2 * SEC });
  const done = s.outbox.enqueue(alarm());
  await idle();
  const closing = s.outbox.close();
  await s.clock.run();
  await closing;
  assert.deepEqual(kinds(s.calls), ["foto", "text"]);
  assert.equal(s.calls[1].text, `⚠️ Eingang: Person am Tor${CLOSED_PHOTO_NOTE}`);
  assert.deepEqual(await done, { ok: true, tries: 2, ms: 4 * SEC, asText: true, photoError: "fetch failed" });
  assert.equal(s.results.length, 1);
});

test("Beenden: ein laufender Text, der scheitert, wird nicht wiederholt", async () => {
  const s = setup({ text: [netz], takesMs: 2 * SEC });
  const done = s.outbox.enqueue(notice());
  await idle();
  const closing = s.outbox.close();
  await s.clock.run();
  await closing;
  assert.equal(s.calls.length, 1);
  assert.deepEqual(await done, { ok: false, tries: 1, ms: 2 * SEC, reason: "fetch failed (Hub wird beendet)", permanent: false });
});

test("Beenden: danach wird nichts mehr angenommen", async () => {
  const s = setup();
  await s.outbox.close();
  await s.outbox.close();
  assert.deepEqual(await s.outbox.enqueue(alarm()), { ok: false, tries: 0, ms: 0, reason: "Hub wird beendet", permanent: false });
  assert.equal(s.calls.length, 0);
  assert.equal(s.outbox.pending(), 0);
});

/* ------------------------------------------------------------ Robustheit */

test("Ein Fehler beim Melden des Ausgangs hält die Warteschlange nicht auf", async () => {
  let n = 0;
  const s = setup({
    onResult: () => {
      n++;
      throw new Error("Log nicht schreibbar");
    },
  });
  const first = s.outbox.enqueue(alarm("c1", "Alarm 1"));
  const second = s.outbox.enqueue(alarm("c1", "Alarm 2"));
  await s.clock.run();
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(n, 2);
  assert.equal(s.errors.length, 2);
  assert.equal(s.calls.length, 2);
});

test("Wirft der Sender ohne Fehlerobjekt, wird wiederholt wie bei einem Netzfehler", async () => {
  const s = setup({ text: [() => "kaputt", "ok"] });
  const done = s.outbox.enqueue(notice());
  await s.clock.run();
  assert.deepEqual(times(s.calls), [0, 5]);
  assert.deepEqual(await done, { ok: true, tries: 2, ms: 5 * SEC, asText: false, photoError: null });
});
