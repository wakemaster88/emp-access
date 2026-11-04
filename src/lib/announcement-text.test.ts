import { test } from "node:test";
import assert from "node:assert/strict";
import { hasPlaceholders, resolveAnnouncementText, spokenTime } from "./announcement-text";
import type { ScheduleSpec } from "./operating-hours";

const TZ = "Europe/Berlin";
const weekend: ScheduleSpec = {
  name: "Wasserski",
  seasons: [
    {
      name: "November",
      startMmDd: "11-01",
      endMmDd: "11-30",
      sortOrder: 0,
      periods: [5, 6].map((weekday) => ({ weekday, opensAt: "12:00", closesAt: "16:00" })),
    },
  ],
  exceptions: [],
};

test("spokenTime", () => {
  assert.equal(spokenTime(12 * 60), "12 Uhr");
  assert.equal(spokenTime(15 * 60 + 50), "15:50 Uhr");
});

test("hasPlaceholders erkennt Varianten", () => {
  assert.ok(hasPlaceholders("es ist {uhrzeit}"));
  assert.ok(hasPlaceholders("ab {Öffnung}"));
  assert.ok(!hasPlaceholders("es ist 20 Uhr"));
  assert.ok(!hasPlaceholders(null));
});

test("Platzhalter aus Uhrzeit und Betriebszeit", () => {
  // Sa 07.11.2026 15:50 MEZ
  const now = new Date("2026-11-07T14:50:00Z");
  const out = resolveAnnouncementText(
    "Es ist {uhrzeit}, geöffnet ab {oeffnung}, wir schließen um {schluss}, also in {minuten} Minuten.",
    { now, timezone: TZ, schedule: weekend },
  );
  assert.equal(out, "Es ist 15:50 Uhr, geöffnet ab 12 Uhr, wir schließen um 16 Uhr, also in 10 Minuten.");
});

test("an geschlossenen Tagen gilt der nächste Betriebstag", () => {
  // Mi 04.11.2026 – nächster Betrieb Sa 12–16
  const out = resolveAnnouncementText("Wir öffnen um {Öffnung}.", {
    now: new Date("2026-11-04T10:00:00Z"),
    timezone: TZ,
    schedule: weekend,
  });
  assert.equal(out, "Wir öffnen um 12 Uhr.");
});

test("ohne Betriebszeit fallen Zeiten weg, Uhrzeit bleibt", () => {
  const out = resolveAnnouncementText("Es ist {uhrzeit}. Schluss {schluss}.", {
    now: new Date("2026-11-04T11:00:00Z"),
    timezone: TZ,
    schedule: null,
  });
  assert.equal(out, "Es ist 12 Uhr. Schluss .");
});
