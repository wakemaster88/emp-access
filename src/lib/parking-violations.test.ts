import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { attachParkingEvidence, processParkingViolation, type ParkingViolationInput } from "./parking-violations";
import { parseHubParkingParams } from "./parking-violations-rules";

/*
 * Ablauf in der Cloud ohne Datenbank: Die Prisma-Aufrufe und Telegram (fetch)
 * werden hier nachgebaut. Jede Abfrage muss nach dem Konto filtern.
 */

const ACCOUNT = 1;
const CAMERA = 9;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const CROP = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);

interface Sighting {
  id: number;
  accountId: number;
  cameraId: number;
  source: string;
  seenAt: Date;
  reportKey: string | null;
  snapshot?: Uint8Array;
  evidence: Uint8Array | null;
  evidenceBlob: string | null;
}

let camera: { id: number; accountId: number; noParkNotifyKey: string | null };
let sightings: Sighting[];
let telegramChats: Array<{ botToken: string; chatId: string }>;
let pushSubs: Array<{ id: number; endpoint: string; p256dh: string; auth: string }>;
/** Reihenfolge der Schritte: lesen, beanspruchen, freigeben, Telegram. */
let events: string[];
/** Telegram-Bilder: Art (bericht/ausschnitt) je Aufruf. */
let photos: string[];
/** Verhalten von Telegram: ok, abgelehnt oder ohne Antwort. */
let telegramMode: "ok" | "reject" | "timeout";
let failTelegramQuery = 0;
let wheres: Array<{ model: string; where: Record<string, unknown> }>;

type Where = Record<string, unknown>;
const tick = () => new Promise((r) => setTimeout(r, 2));

function keyMatches(cond: unknown, v: string | null): boolean {
  if (cond === null) return v === null;
  if (typeof cond === "string") return v === cond;
  if (cond && typeof cond === "object" && "notIn" in cond) {
    // Wie SQL: NULL ist nicht „not in“.
    return v !== null && !(cond as { notIn: string[] }).notIn.includes(v);
  }
  throw new Error(`unbekannte Bedingung ${JSON.stringify(cond)}`);
}

function cameraMatches(where: Where): boolean {
  if (where.id !== camera.id || where.accountId !== camera.accountId) return false;
  if (Array.isArray(where.OR)) return where.OR.some((c: Where) => keyMatches(c.noParkNotifyKey, camera.noParkNotifyKey));
  if ("noParkNotifyKey" in where) return keyMatches(where.noParkNotifyKey, camera.noParkNotifyKey);
  return true;
}

function sightingMatches(s: Sighting, where: Where): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "seenAt") {
      if (s.seenAt < (v as { gte: Date }).gte) return false;
    } else if (k === "evidence") {
      if (v === null ? s.evidence !== null : s.evidence === null) return false;
    } else if (k === "evidenceBlob") {
      if (s.evidenceBlob !== v) return false;
    } else if ((s as unknown as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

function note(model: string, where: Where) {
  wheres.push({ model, where });
}

const stubs = {
  camera: {
    findFirst: async ({ where }: { where: Where }) => {
      note("camera", where);
      events.push("lesen");
      return cameraMatches(where) ? { noParkNotifyKey: camera.noParkNotifyKey } : null;
    },
    updateMany: async ({ where, data }: { where: Where; data: { noParkNotifyKey: string | null } }) => {
      note("camera", where);
      if (!cameraMatches(where)) return { count: 0 };
      events.push(data.noParkNotifyKey === null || !String(data.noParkNotifyKey).endsWith("+e") ? `marke ${data.noParkNotifyKey}` : "marke ausschnitt");
      camera.noParkNotifyKey = data.noParkNotifyKey;
      return { count: 1 };
    },
  },
  vehicleSighting: {
    findFirst: async ({ where }: { where: Where }) => {
      note("vehicleSighting", where);
      events.push("lesen");
      await tick();
      const found = sightings.filter((s) => sightingMatches(s, where)).sort((a, b) => +b.seenAt - +a.seenAt)[0];
      return found ? { ...found, camera: { name: "Einfahrt" } } : null;
    },
    create: async ({ data }: { data: Omit<Sighting, "id" | "evidence" | "evidenceBlob"> }) => {
      note("vehicleSighting", data as unknown as Where);
      const row: Sighting = { evidence: null, evidenceBlob: null, ...data, id: 100 + sightings.length };
      sightings.push(row);
      return { id: row.id };
    },
    count: async ({ where }: { where: Where }) => {
      note("vehicleSighting", where);
      return sightings.filter((s) => sightingMatches(s, where)).length;
    },
    updateMany: async ({ where, data }: { where: Where; data: Partial<Sighting> }) => {
      note("vehicleSighting", where);
      const rows = sightings.filter((s) => sightingMatches(s, where));
      for (const r of rows) Object.assign(r, data);
      return { count: rows.length };
    },
  },
  account: {
    findUnique: async ({ where }: { where: Where }) => {
      note("account", { accountId: where.id });
      events.push("lesen");
      return { timezone: "Europe/Berlin" };
    },
  },
  telegramConfig: {
    findMany: async ({ where }: { where: Where }) => {
      note("telegramConfig", where);
      events.push("lesen");
      if (failTelegramQuery > 0) {
        failTelegramQuery--;
        throw new Error("Datenbank nicht erreichbar");
      }
      return telegramChats;
    },
  },
  pushSubscription: {
    findMany: async ({ where }: { where: Where }) => {
      note("pushSubscription", where);
      events.push("lesen");
      return pushSubs;
    },
    deleteMany: async ({ where }: { where: Where }) => {
      note("pushSubscription", where);
      return { count: 0 };
    },
  },
};

const realFetch = globalThis.fetch;
const saved = new Map<string, Record<string, unknown>>();
const env = { pub: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };

beforeEach(() => {
  camera = { id: CAMERA, accountId: ACCOUNT, noParkNotifyKey: null };
  sightings = [];
  telegramChats = [{ botToken: "bot", chatId: "chat" }];
  pushSubs = [];
  events = [];
  photos = [];
  wheres = [];
  telegramMode = "ok";
  failTelegramQuery = 0;
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  for (const [model, methods] of Object.entries(stubs)) {
    const delegate = (prisma as unknown as Record<string, Record<string, unknown>>)[model];
    if (!saved.has(model)) saved.set(model, { ...delegate });
    Object.assign(delegate, methods);
  }
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith("https://api.telegram.org/")) throw new Error(`unerwartet: ${u}`);
    if (telegramMode === "timeout") throw new Error("The operation was aborted due to timeout");
    if (u.endsWith("/sendPhoto")) {
      const caption = String((init?.body as FormData).get("caption") ?? "");
      if (telegramMode === "ok") photos.push(caption.startsWith("Ausschnitt") ? "ausschnitt" : "bericht");
    }
    events.push("telegram");
    return new Response(JSON.stringify(telegramMode === "ok" ? { ok: true } : { ok: false, description: "chat not found" }));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (env.pub !== undefined) process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = env.pub;
  if (env.priv !== undefined) process.env.VAPID_PRIVATE_KEY = env.priv;
  // Jede Abfrage filtert nach dem Konto.
  for (const w of wheres) assert.equal(w.where.accountId, ACCOUNT, `${w.model} ohne accountId: ${JSON.stringify(w.where)}`);
});

function input(query: string, at = new Date(Date.UTC(2026, 10, 6, 11, 2))): ParkingViolationInput {
  return {
    accountId: ACCOUNT,
    cameraId: CAMERA,
    cameraName: "Einfahrt",
    vehicles: 1,
    seconds: 120,
    snapshot: JPEG,
    at,
    params: parseHubParkingParams(new URLSearchParams(query)),
  };
}

const FIRST = "notify=1&store=1&inZone=1&storeKey=1764154800000-0&notifyKey=1764154920000-f";

test("Abfragen vor dem Beanspruchen: scheitert eine, bleibt die Nachricht für den nächsten Versuch frei", async () => {
  failTelegramQuery = 1;
  await assert.rejects(processParkingViolation(input(FIRST)));
  assert.equal(camera.noParkNotifyKey, null);
  assert.deepEqual(photos, []);
  // Nächster Versuch: dieselbe Sichtung, jetzt mit Nachricht.
  events = [];
  const res = await processParkingViolation(input(FIRST));
  assert.deepEqual([res.sightingExisted, res.telegram, camera.noParkNotifyKey], [true, 1, "1764154920000-f"]);
  assert.equal(sightings.length, 1);
  // Erst alles lesen, dann beanspruchen, dann schicken.
  const claim = events.indexOf("marke 1764154920000-f");
  assert.ok(claim > events.lastIndexOf("lesen"), events.join(", "));
  assert.ok(claim < events.indexOf("telegram"), events.join(", "));
});

test("Nachweislich nichts verschickt: Schlüssel wieder frei, der nächste Versuch schickt die Nachricht", async () => {
  camera.noParkNotifyKey = "1764150000000-r3";
  telegramMode = "reject";
  const res = await processParkingViolation(input(FIRST));
  assert.equal(res.undelivered, true);
  assert.equal(camera.noParkNotifyKey, "1764150000000-r3");
  telegramMode = "ok";
  const again = await processParkingViolation(input(FIRST));
  assert.deepEqual([again.undelivered, again.telegram, again.sightingExisted], [undefined, 1, true]);
  assert.deepEqual(photos, ["bericht"]);
  assert.equal(camera.noParkNotifyKey, "1764154920000-f");
});

test("Nachricht nicht zugestellt (502): Ausschnitt in die Historie ohne Telegram, mit der Nachricht des nächsten Versuchs einmal an Telegram", async () => {
  telegramMode = "reject";
  const res = await processParkingViolation(input(FIRST));
  assert.deepEqual([res.undelivered, camera.noParkNotifyKey], [true, null]);
  // Der Hub legt den Ausschnitt trotzdem ab – ohne notifyKey und ohne Telegram.
  const at = new Date(Date.UTC(2026, 10, 6, 11, 2, 30));
  const attach = (notifyKey: string | null) =>
    attachParkingEvidence({ accountId: ACCOUNT, sightingId: res.sightingId!, jpeg: CROP, notifyKey, telegram: false, at });
  assert.deepEqual(await attach(null), { ok: true, telegram: 0 });
  assert.deepEqual([Buffer.from(sightings[0].evidence!), photos], [CROP, []]);
  // Nächster Versuch: Die Nachricht geht hinaus, dazu der gespeicherte Ausschnitt genau einmal.
  telegramMode = "ok";
  const again = await processParkingViolation(input(FIRST));
  assert.deepEqual([again.undelivered, again.telegram, again.sightingExisted], [undefined, 1, true]);
  assert.deepEqual(await attach("1764154920000-f"), { ok: true, telegram: 1, existed: true });
  assert.deepEqual(photos, ["bericht", "ausschnitt"]);
  assert.equal(camera.noParkNotifyKey, "1764154920000-f+e");
  // Ein weiterer Aufruf (Antwort verloren): kein zweites Mal.
  assert.deepEqual(await attach("1764154920000-f"), { ok: false, reason: "exists" });
  assert.deepEqual(await attach(null), { ok: false, reason: "exists" });
  assert.deepEqual(photos, ["bericht", "ausschnitt"]);
  assert.equal(sightings.length, 1);
});

test("Telegram ohne Antwort (Zeitüberschreitung): Ob die Nachricht ankam, ist offen – kein zweites Mal", async () => {
  telegramMode = "timeout";
  const res = await processParkingViolation(input(FIRST));
  assert.equal(res.undelivered, undefined);
  assert.equal(camera.noParkNotifyKey, "1764154920000-f");
  telegramMode = "ok";
  const again = await processParkingViolation(input(FIRST));
  assert.equal(again.skipped, "duplicate");
  assert.deepEqual(photos, []);
});

test("Push scheitert vor dem Versand (VAPID ungültig): Telegram geht trotzdem, ohne Telegram wird freigegeben", async () => {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "ungueltig";
  process.env.VAPID_PRIVATE_KEY = "ungueltig";
  pushSubs = [{ id: 1, endpoint: "https://push.example.invalid/1", p256dh: "x", auth: "y" }];
  const res = await processParkingViolation(input(FIRST));
  assert.deepEqual([res.pushed, res.telegram, res.undelivered], [0, 1, undefined]);
  // Ohne Telegram: nachweislich nichts hinaus.
  camera.noParkNotifyKey = null;
  telegramChats = [];
  const none = await processParkingViolation(input(FIRST.replace("-f", "-r1") + "&reminder=1"));
  assert.equal(none.undelivered, true);
  assert.equal(camera.noParkNotifyKey, null);
});

test("Erste Nachricht ohne neuen Eintrag: gespeicherter Ausschnitt geht genau einmal an Telegram", async () => {
  // Nachts um 23:02 gespeichert, mit Ausschnitt.
  sightings.push({
    id: 7,
    accountId: ACCOUNT,
    cameraId: CAMERA,
    source: "NO_PARKING",
    seenAt: new Date(Date.UTC(2026, 10, 5, 22, 2)),
    reportKey: "1764972000000-0",
    evidence: CROP,
    evidenceBlob: null,
  });
  const at = new Date(Date.UTC(2026, 10, 6, 6, 0));
  const morning = "notify=1&store=0&inZone=1&notifyKey=1764972120000-f&evidenceKey=1764972000000-0";
  const res = await processParkingViolation(input(morning, at));
  assert.deepEqual([res.telegram, res.evidenceTelegram], [1, 1]);
  assert.deepEqual(photos, ["bericht", "ausschnitt"]);
  assert.equal(camera.noParkNotifyKey, "1764972120000-f+e");
  // Antwort ging verloren, der Hub wiederholt: weder Nachricht noch Ausschnitt ein zweites Mal.
  const again = await processParkingViolation(input(morning, at));
  assert.deepEqual([again.skipped, again.telegram, again.evidenceTelegram], ["duplicate", 0, undefined]);
  assert.deepEqual(photos, ["bericht", "ausschnitt"]);
  // Die nächste Nachricht (Erinnerung) wird trotz der Marke beansprucht.
  const reminder = await processParkingViolation(input("notify=1&store=0&inZone=1&reminder=1&notifyKey=1764972120000-r1", at));
  assert.equal(reminder.telegram, 1);
  assert.equal(camera.noParkNotifyKey, "1764972120000-r1");
});

test("Nachricht ging bei einem früheren Versuch hinaus, der Ausschnitt nicht: der Wiederholungsversuch holt ihn nach", async () => {
  sightings.push({
    id: 7,
    accountId: ACCOUNT,
    cameraId: CAMERA,
    source: "NO_PARKING",
    seenAt: new Date(Date.UTC(2026, 10, 5, 22, 2)),
    reportKey: "1764972000000-0",
    evidence: CROP,
    evidenceBlob: null,
  });
  camera.noParkNotifyKey = "1764972120000-f";
  const at = new Date(Date.UTC(2026, 10, 6, 6, 1));
  const res = await processParkingViolation(input("notify=1&store=0&inZone=1&notifyKey=1764972120000-f&evidenceKey=1764972000000-0", at));
  assert.deepEqual([res.skipped, res.evidenceTelegram], ["duplicate", 1]);
  assert.deepEqual(photos, ["ausschnitt"]);
});

test("Ausschnitt zur Sichtung, zweimal gleichzeitig: einer wird abgelegt und geht einmal an Telegram", async () => {
  const report = await processParkingViolation(input(FIRST));
  assert.deepEqual(photos, ["bericht"]);
  const evidence = () =>
    attachParkingEvidence({
      accountId: ACCOUNT,
      sightingId: report.sightingId!,
      jpeg: CROP,
      notifyKey: "1764154920000-f",
      telegram: true,
      at: new Date(Date.UTC(2026, 10, 6, 11, 3)),
    });
  const results = await Promise.all([evidence(), evidence()]);
  assert.deepEqual(
    results.map((r) => (r.ok ? `ok ${r.telegram}` : r.reason)).sort(),
    ["exists", "ok 1"],
  );
  assert.deepEqual(photos, ["bericht", "ausschnitt"]);
  assert.equal(camera.noParkNotifyKey, "1764154920000-f+e");
});

test("Ausschnitt nach verlorener Antwort: geht an Telegram, solange zur ersten Nachricht noch keiner ging", async () => {
  // Erster Versuch: Nachricht hinaus, Antwort verloren; zweiter Versuch: duplicate, telegram 0.
  await processParkingViolation(input(FIRST));
  const retry = await processParkingViolation(input(FIRST));
  assert.deepEqual([retry.skipped, retry.telegram, retry.sightingExisted], ["duplicate", 0, true]);
  // Der Hub reicht den Ausschnitt mit dem Schlüssel der ersten Nachricht nach.
  const res = await attachParkingEvidence({
    accountId: ACCOUNT,
    sightingId: retry.sightingId!,
    jpeg: CROP,
    notifyKey: "1764154920000-f",
    telegram: false,
    at: new Date(Date.UTC(2026, 10, 6, 11, 3)),
  });
  assert.deepEqual(res, { ok: true, telegram: 1 });
  assert.deepEqual(photos, ["bericht", "ausschnitt"]);
});

test("Ausschnitt eines älteren Hubs (telegram=1, ohne notifyKey): wie bisher", async () => {
  // Später am Tag: Die Sperre für ältere Hubs (Merker im Speicher) greift nicht.
  const at = new Date(Date.UTC(2026, 10, 6, 17, 0));
  const report = await processParkingViolation(input("cameraId=9&vehicles=1&seconds=130", at));
  const res = await attachParkingEvidence({
    accountId: ACCOUNT,
    sightingId: report.sightingId!,
    jpeg: CROP,
    notifyKey: null,
    telegram: true,
    at: new Date(at.getTime() + 60_000),
  });
  assert.deepEqual(res, { ok: true, telegram: 1 });
  assert.deepEqual(photos, ["bericht", "ausschnitt"]);
  // Fremdes Konto: nicht gefunden.
  const other = await attachParkingEvidence({ accountId: 2, sightingId: report.sightingId!, jpeg: CROP, notifyKey: null, telegram: true, at });
  assert.deepEqual(other, { ok: false, reason: "not_found" });
  wheres = wheres.filter((w) => w.where.accountId !== 2);
});

test("Zwei Fahrzeuge mit eigenem Schlüssel: zwei Sichtungen; derselbe Schlüssel: eine", async () => {
  const a = await processParkingViolation(input("notify=0&store=1&inZone=2&storeKey=1764154800000-0"));
  const b = await processParkingViolation(input("notify=0&store=1&inZone=2&storeKey=1764154800000-1"));
  const again = await processParkingViolation(input("notify=0&store=1&inZone=2&storeKey=1764154800000-0"));
  assert.notEqual(a.sightingId, b.sightingId);
  assert.deepEqual([again.sightingId, again.sightingExisted], [a.sightingId, true]);
  assert.equal(sightings.length, 2);
});
