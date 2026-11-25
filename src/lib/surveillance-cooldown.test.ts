import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COOLDOWN_ISO_RE,
  claimCooldown,
  cooldownMs,
  cooldownOpen,
  type CooldownStore,
} from "./surveillance-cooldown";

const at = (iso: string) => new Date(iso);

test("cooldownOpen: ohne Eintrag, nach Ablauf und mit unlesbarem Wert offen", () => {
  const now = at("2026-11-23T22:04:05.000Z");
  assert.equal(cooldownOpen(null, "8:PERSON", now, 5), true);
  assert.equal(cooldownOpen({}, "8:PERSON", now, 5), true);
  assert.equal(cooldownOpen({ "8:PERSON": "2026-11-23T21:59:05.000Z" }, "8:PERSON", now, 5), true, "genau 5 min");
  assert.equal(cooldownOpen({ "8:PERSON": "2026-11-23T21:59:05.001Z" }, "8:PERSON", now, 5), false, "1 ms zu früh");
  assert.equal(cooldownOpen({ "8:PERSON": "kaputt" }, "8:PERSON", now, 5), true);
  assert.equal(cooldownOpen({ "8:PERSON": 12 }, "8:PERSON", now, 5), true);
});

test("cooldownOpen: Sperrzeit gilt je Schlüssel, ein späterer Zeitpunkt sperrt", () => {
  const now = at("2026-11-23T22:04:05.000Z");
  const map = { "8:PERSON": "2026-11-23T22:02:00.000Z", "tg:8:PERSON": "2026-11-23T21:50:00.000Z" };
  assert.equal(cooldownOpen(map, "8:PERSON", now, 5), false);
  assert.equal(cooldownOpen(map, "tg:8:PERSON", now, 5), true);
  assert.equal(cooldownOpen(map, "8:VEHICLE", now, 5), true);
  assert.equal(cooldownOpen({ "8:PERSON": "2026-11-23T22:10:00.000Z" }, "8:PERSON", now, 5), false);
});

test("cooldownOpen: mindestens eine Minute, wie in der Einstellung", () => {
  const now = at("2026-11-23T22:04:05.000Z");
  const map = { k: "2026-11-23T22:03:30.000Z" };
  assert.equal(cooldownMs(0), 60_000);
  assert.equal(cooldownOpen(map, "k", now, 0), false);
  assert.equal(cooldownOpen(map, "k", now, Number.NaN), false);
});

/**
 * Nachgebauter Speicher wie die Anweisung in surveillance.ts: Pruefen und
 * Schreiben eines Schluessels geschehen in einem Schritt, die uebrigen
 * Schluessel bleiben stehen. `delayMs` laesst gleichzeitige Aufrufe
 * ineinanderlaufen, bevor sie ankommen.
 */
function fakeStore(initial: Record<string, unknown> = {}, delayMs = 0) {
  const rows = new Map<number, Record<string, unknown>>([[1, { ...initial }]]);
  const store: CooldownStore = {
    async claim(configId, key, iso, notAfterIso) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const row = rows.get(configId);
      if (!row) return 0;
      const cur = row[key];
      // Wie in SQL: fehlt, kein Zeitpunkt im Format, oder Textvergleich <= Grenze.
      const open = typeof cur !== "string" || !COOLDOWN_ISO_RE.test(cur) || cur <= notAfterIso;
      if (!open) return 0;
      row[key] = iso;
      return 1;
    },
  };
  return { store, row: () => rows.get(1)! };
}

/** Wie maybeSurveillanceAlert/-TelegramAlert: senden nur, wenn die Sperrzeit gesetzt wurde. */
async function alertOnce(store: CooldownStore, key: string, iso: string, sent: string[]): Promise<boolean> {
  const claimed = await claimCooldown(store, { configId: 1, key, at: at(iso), minutes: 5 });
  if (claimed) sent.push(`${key}@${iso}`);
  return claimed;
}

test("zwei gleichzeitige Schreiber: beide Schlüssel bleiben, der zweite Versand in der Sperrzeit unterbleibt", async () => {
  const { store, row } = fakeStore({ "3:VEHICLE": "2026-11-15T01:00:00.000Z" }, 5);
  const sent: string[] = [];
  // Sichtung 01:50:35: Push und Telegram laufen nebeneinander.
  const [push, tg] = await Promise.all([
    alertOnce(store, "2:PERSON", "2026-11-15T01:50:35.000Z", sent),
    alertOnce(store, "tg:2:PERSON", "2026-11-15T01:50:35.000Z", sent),
  ]);
  assert.deepEqual([push, tg], [true, true]);
  assert.equal(row()["2:PERSON"], "2026-11-15T01:50:35.000Z");
  assert.equal(row()["tg:2:PERSON"], "2026-11-15T01:50:35.000Z");
  assert.equal(row()["3:VEHICLE"], "2026-11-15T01:00:00.000Z", "fremder Schlüssel bleibt");

  // Nächste Sichtung 01:53:28, innerhalb der 5 Minuten: weder Push noch Telegram.
  const again = await Promise.all([
    alertOnce(store, "2:PERSON", "2026-11-15T01:53:28.000Z", sent),
    alertOnce(store, "tg:2:PERSON", "2026-11-15T01:53:28.000Z", sent),
  ]);
  assert.deepEqual(again, [false, false]);
  assert.equal(sent.length, 2);
  assert.equal(row()["tg:2:PERSON"], "2026-11-15T01:50:35.000Z", "Sperrzeit bleibt beim ersten Versand");

  // Nach Ablauf (01:56:26 liegt erst 5:51 nach 01:50:35) wieder beide.
  const later = await Promise.all([
    alertOnce(store, "2:PERSON", "2026-11-15T01:56:26.000Z", sent),
    alertOnce(store, "tg:2:PERSON", "2026-11-15T01:56:26.000Z", sent),
  ]);
  assert.deepEqual(later, [true, true]);
  assert.equal(sent.length, 4);
});

test("zwei gleichzeitige Sichtungen derselben Kamera: nur eine Meldung je Kanal", async () => {
  const { store } = fakeStore({}, 5);
  const sent: string[] = [];
  const results = await Promise.all([
    alertOnce(store, "tg:8:PERSON", "2026-11-23T22:04:05.000Z", sent),
    alertOnce(store, "tg:8:PERSON", "2026-11-23T22:04:06.000Z", sent),
  ]);
  assert.deepEqual(results.filter(Boolean).length, 1);
  assert.equal(sent.length, 1);
});

test("Speicher-Bedingung entspricht cooldownOpen", async () => {
  const now = at("2026-11-23T22:04:05.000Z");
  const values: unknown[] = [
    undefined,
    "2026-11-23T21:59:05.000Z",
    "2026-11-23T21:59:05.001Z",
    "2026-11-23T22:04:05.000Z",
    "2026-11-23T22:10:00.000Z",
    "2025-01-01T00:00:00.000Z",
    "kaputt",
    "2026-11-23T22:00:00Z",
    42,
  ];
  for (const v of values) {
    const initial = v === undefined ? {} : { k: v };
    const { store } = fakeStore(initial);
    const claimed = await claimCooldown(store, { configId: 1, key: "k", at: now, minutes: 5 });
    assert.equal(claimed, cooldownOpen(initial, "k", now, 5), `Wert ${String(v)}`);
  }
});

test("claimCooldown: unbekannte Zeile ändert nichts", async () => {
  const { store } = fakeStore();
  assert.equal(await claimCooldown(store, { configId: 2, key: "k", at: at("2026-11-23T22:04:05.000Z"), minutes: 5 }), false);
});
