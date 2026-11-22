import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSyncReport, type WebsiteData } from "./opening-sync";
import type { ScheduleSpec } from "./operating-hours";

const spec: ScheduleSpec = {
  name: "Gastronomie",
  seasons: [
    {
      name: "Ganzjahr",
      startMmDd: "01-01",
      endMmDd: "12-31",
      sortOrder: 0,
      periods: [5, 6].map((weekday) => ({ weekday, opensAt: "12:00", closesAt: "18:00" })),
    },
  ],
  exceptions: [],
};

// Website mit veralteten eigenen Zeiten: jeden Tag 10–20.
const website = async (): Promise<WebsiteData> => ({
  pages: [{ id: 7, slug: "gastro", annyResourceId: null }],
  periods: new Map([
    [7, [{ validFrom: "2026-01-01", validTo: "2027-12-31", jsDay: null, timeText: "10:00 - 20:00", isClosed: false, priority: 0 }]],
  ]),
  dates: new Map(),
});

const base = {
  schedules: [{ id: 4, name: "Gastronomie", spec }],
  timezone: "Europe/Berlin",
  anny: null,
  links: [],
  websiteUrl: "postgres://nur-test",
  now: new Date("2026-11-22T12:00:00Z"),
};

test("Abgleich: Seite liest live aus emp-access -> gleich", async () => {
  const report = await buildSyncReport({
    ...base,
    loaders: { website, websiteLive: async (slugs) => new Set(slugs) },
  });
  const site = report.rows[0].website;
  assert.equal(site.state, "same");
  assert.equal(site.viaEmp, true);
  assert.equal(site.result?.differing, 0);
  assert.equal(site.lastDay, report.to);
});

test("Abgleich: ohne Übernahme zählen die eigenen Tabellen der Website", async () => {
  const report = await buildSyncReport({
    ...base,
    loaders: { website, websiteLive: async () => new Set() },
  });
  const site = report.rows[0].website;
  assert.equal(site.state, "diff");
  assert.ok((site.result?.differing ?? 0) > 300);
  assert.equal(site.viaEmp, undefined);
});
