import { test } from "node:test";
import assert from "node:assert/strict";
import { ROOMS_MAX_AGE_MS, effectiveClosed, roomsClosed, roomsFinding } from "./sentinel-rooms-rules.js";

const now = Date.parse("2026-11-25T17:00:00.000Z");
const min = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const ec = (open: boolean, nextChangeAt: string | null | undefined, ageMin: number | null) =>
  effectiveClosed({ open, nextChangeAt, syncedAt: ageMin === null ? null : iso(now - ageMin * min), now, maxAgeMs: ROOMS_MAX_AGE_MS });

test("effectiveClosed: ein Stand jünger als 10 Minuten gilt wie geliefert", () => {
  assert.equal(ec(true, iso(now + 60 * min), 9), false);
  assert.equal(ec(false, iso(now + 60 * min), 9), true);
  // Auch wenn der Wechsel schon vorbei wäre: der frische Stand zählt.
  assert.equal(ec(true, iso(now - 5 * min), 2), false);
  assert.equal(ec(false, null, 0), true);
});

test("effectiveClosed: ein älterer Stand gilt bis nextChangeAt weiter", () => {
  assert.equal(ec(true, iso(now + 1 * min), 11), false);
  assert.equal(ec(false, iso(now + 5 * 30 * 24 * 60 * min), 600), true, "Winter: geschlossen bis zum Saisonbeginn");
});

test("effectiveClosed: nach nextChangeAt wird aus offen geschlossen, aus geschlossen das Nachtfenster", () => {
  // Offen um 17:55, Betriebsende 18:00, danach keine Verbindung: bewacht.
  assert.equal(ec(true, iso(now - 1 * min), 15), true);
  assert.equal(ec(true, iso(now), 15), true, "genau zum Wechsel");
  // Geschlossen bis 09:00, danach keine Verbindung: nicht abgeschaltet, das Nachtfenster entscheidet.
  assert.equal(ec(false, iso(now - 1 * min), 15), null);
});

test("effectiveClosed: ohne nextChangeAt und älter als 10 Minuten entscheidet das Nachtfenster", () => {
  assert.equal(ec(true, undefined, 10), null);
  assert.equal(ec(false, null, 11), null);
  assert.equal(ec(false, "kaputt", 11), null);
  // Ohne Zeitpunkt des Stands gilt er als alt.
  assert.equal(ec(false, null, null), null);
  assert.equal(ec(true, iso(now + 30 * min), null), false);
});

test("effectiveClosed: ein Stand aus der Zukunft (Uhr verstellt) gilt als alt", () => {
  assert.equal(effectiveClosed({ open: true, nextChangeAt: null, syncedAt: iso(now + 20 * min), now, maxAgeMs: ROOMS_MAX_AGE_MS }), null);
});

test("roomsClosed: ein offener Raum hebt die Bewachung auf, alle geschlossen bewachen", () => {
  const fresh = iso(now - min);
  assert.deepEqual(roomsClosed([], fresh, now), { closed: null, rooms: [], stale: false });
  assert.deepEqual(roomsClosed([{ name: "Shop", open: false }, { name: "Strandbad", open: false }], fresh, now), {
    closed: true,
    rooms: ["Shop", "Strandbad"],
    stale: false,
  });
  assert.equal(roomsClosed([{ name: "Shop", open: true }, { name: "Strandbad", open: false }], fresh, now).closed, false);
});

test("roomsClosed: alter Stand schaltet nur ein oder fällt aufs Nachtfenster zurück", () => {
  const old = iso(now - 30 * min);
  // Shop wäre seit 18:00 zu: jetzt bewacht.
  const r = roomsClosed([{ name: "Shop", open: true, nextChangeAt: iso(now - 5 * min) }], old, now);
  assert.deepEqual(r, { closed: true, rooms: ["Shop"], stale: true });
  // Strandbad bis Mai zu, Shop nach seinem Wechsel unsicher: Nachtfenster.
  assert.equal(
    roomsClosed(
      [
        { name: "Strandbad", open: false, nextChangeAt: iso(now + 100 * 24 * 60 * min) },
        { name: "Shop", open: false, nextChangeAt: iso(now - 5 * min) },
      ],
      old,
      now
    ).closed,
    null
  );
  // Ältere Cloud ohne nextChangeAt: Nachtfenster.
  assert.equal(roomsClosed([{ name: "Strandbad", open: false }], old, now).closed, null);
});

test("roomsFinding: ab 30 Minuten „Raumdaten seit N min alt“, ohne Stand ab Start", () => {
  const startedAt = now - 120 * min;
  assert.equal(roomsFinding({ syncedAt: now - 29 * min, startedAt, now, error: "HTTP 503" }), null);
  const f = roomsFinding({ syncedAt: now - 47 * min, startedAt, now, error: "HTTP 503" });
  assert.equal(f?.key, "rooms");
  assert.equal(f?.severity, "warn");
  assert.equal(f?.title, "Raumdaten seit 47 min alt");
  assert.match(f?.detail ?? "", /^Abruf: HTTP 503\. Der Wächter hält den letzten Stand/);
  assert.equal(roomsFinding({ syncedAt: null, startedAt: now - 10 * min, now, error: null }), null);
  assert.equal(roomsFinding({ syncedAt: null, startedAt: now - 31 * min, now, error: "fetch failed" })?.title, "Raumdaten fehlen seit 31 min");
});
