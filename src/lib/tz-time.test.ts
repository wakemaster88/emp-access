import assert from "node:assert/strict";
import { test } from "node:test";
import { tzInstant, tzMinutesOfDay, tzWeekdayBit, tzYmd, windowWeekday } from "./tz-time";

const TZ = "Europe/Berlin";

// 28.11.2026 ist ein Samstag (Bit 5), im November gilt MEZ (UTC+1).
test("windowWeekday: Morgen-Teil eines Nachtfensters gehoert zum Vortag", () => {
  assert.equal(windowWeekday(new Date("2026-11-28T22:00:00Z"), "22:00", "08:00", TZ), 5, "Sa 23:00");
  assert.equal(windowWeekday(new Date("2026-11-29T01:00:00Z"), "22:00", "08:00", TZ), 5, "So 02:00");
  assert.equal(windowWeekday(new Date("2026-11-29T07:00:00Z"), "22:00", "08:00", TZ), 6, "So 08:00");
  assert.equal(windowWeekday(new Date("2026-11-30T01:00:00Z"), "22:00", "08:00", TZ), 6, "Mo 02:00 gehoert zum Sonntag");
  assert.equal(windowWeekday(new Date("2026-11-23T01:00:00Z"), "22:00", "08:00", TZ), 6, "Mo 02:00 nach Sonntagnacht");
});

test("windowWeekday: ohne Mitternacht oder ohne Fenster gilt der Kalendertag", () => {
  assert.equal(windowWeekday(new Date("2026-11-29T01:00:00Z"), "01:00", "08:00", TZ), 6);
  assert.equal(windowWeekday(new Date("2026-11-29T01:00:00Z"), null, null, TZ), 6);
  assert.equal(windowWeekday(new Date("2026-11-29T01:00:00Z"), "22:00", "22:00", TZ), 6, "gleiche Werte: immer");
  assert.equal(windowWeekday(new Date("2026-11-29T01:00:00Z"), "kaputt", "08:00", TZ), 6);
});

test("windowWeekday: Zeitumstellung im Morgen-Teil", () => {
  // So 28.03.2027 03:30 MESZ (01:30 UTC), Fenster 22–8: gehoert zum Samstag.
  assert.equal(windowWeekday(new Date("2027-03-28T01:30:00Z"), "22:00", "08:00", TZ), 5);
  // So 31.10.2027 02:30 MEZ (01:30 UTC), zweites 02:30: ebenfalls Samstag.
  assert.equal(windowWeekday(new Date("2027-10-31T01:30:00Z"), "22:00", "08:00", TZ), 5);
});

// ─── Wiederverwendete Formatter ─────────────────────────────────────────────

/** Die Fassung ohne Wiederverwendung, wie vor dem Zwischenspeicher. */
function frischeYmd(at: Date, tz: string): string {
  return at.toLocaleDateString("sv-SE", { timeZone: tz });
}
function frischeMinuten(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  return (h === 24 ? 0 : h) * 60 + m;
}
function frischerWochentag(at: Date, tz: string): number {
  const d = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(at).toLowerCase();
  return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(d);
}

test("tz-Helfer: gleiche Ergebnisse wie ohne Wiederverwendung, über Zeitumstellung und Jahreswechsel", () => {
  const zonen = [TZ, "UTC", "America/New_York", "Asia/Kolkata", "Pacific/Auckland"];
  // Alle 37 Minuten ueber die Umstellungen 2027 und den Jahreswechsel.
  const spannen: Array<[string, string]> = [
    ["2027-03-27T00:00:00Z", "2027-03-29T00:00:00Z"],
    ["2027-10-30T00:00:00Z", "2027-11-01T00:00:00Z"],
    ["2026-12-31T00:00:00Z", "2027-01-02T00:00:00Z"],
  ];
  for (const tz of zonen) {
    for (const [a, b] of spannen) {
      for (let t = Date.parse(a); t < Date.parse(b); t += 37 * 60_000) {
        const at = new Date(t);
        assert.equal(tzYmd(at, tz), frischeYmd(at, tz), `${tz} ${at.toISOString()}`);
        assert.equal(tzMinutesOfDay(at, tz), frischeMinuten(at, tz), `${tz} ${at.toISOString()}`);
        assert.equal(tzWeekdayBit(at, tz), frischerWochentag(at, tz), `${tz} ${at.toISOString()}`);
      }
    }
  }
  // Umstellung: 02:30 gibt es am 28.03.2027 nicht (eine Stunde spaeter), am
  // 31.10.2027 doppelt (einmal, in MEZ). Wie vor dem Zwischenspeicher.
  assert.equal(tzInstant("2027-03-28", "02:30", TZ)?.toISOString(), "2027-03-28T01:30:00.000Z");
  assert.equal(tzInstant("2027-10-31", "02:30", TZ)?.toISOString(), "2027-10-31T01:30:00.000Z");
  assert.equal(tzInstant("2026-11-28", "18:30", TZ)?.toISOString(), "2026-11-28T17:30:00.000Z");
});

test("tz-Helfer: ungültige Zeitzone wirft weiterhin, auch beim zweiten Mal", () => {
  assert.throws(() => tzYmd(new Date(), "Mars/Olympus"), RangeError);
  assert.throws(() => tzYmd(new Date(), "Mars/Olympus"), RangeError);
});
