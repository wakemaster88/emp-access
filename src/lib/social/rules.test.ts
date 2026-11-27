import { test } from "node:test";
import assert from "node:assert/strict";
import {
  berlinLocalToDate, campaignPhase, isOverdue, nextPublishedAt, normalizeHashtags, parseCampaignInput, parsePostInput,
  periodLabel, postCopyText, slugify, toBerlinLocalInput,
} from "./rules";

test("slugify: Umlaute, Leerzeichen und Sonderzeichen", () => {
  assert.equal(slugify("Nikolausfahren 2026"), "nikolausfahren-2026");
  assert.equal(slugify("Saisonstart – Überraschung! Größe"), "saisonstart-ueberraschung-groesse");
  assert.equal(slugify("  --  "), "");
});

test("campaignPhase: geplant, läuft, vorbei, offen", () => {
  assert.equal(campaignPhase(null, null, "2026-11-27"), "OPEN");
  assert.equal(campaignPhase("2026-12-06", "2026-12-06", "2026-11-27"), "PLANNED");
  assert.equal(campaignPhase("2026-12-06", "2026-12-06", "2026-12-06"), "RUNNING");
  assert.equal(campaignPhase("2026-12-06", "2026-12-06", "2026-12-07"), "DONE");
  assert.equal(campaignPhase("2026-11-01", null, "2027-05-01"), "RUNNING");
  assert.equal(campaignPhase(null, "2026-11-01", "2026-11-27"), "DONE");
});

test("periodLabel", () => {
  assert.equal(periodLabel("2026-12-06", "2026-12-06"), "6.12.2026");
  assert.equal(periodLabel("2026-11-20", "2026-12-06"), "20.11. – 6.12.2026");
  assert.equal(periodLabel("2026-12-20", "2027-01-06"), "20.12.2026 – 6.1.2027");
  assert.equal(periodLabel("2026-12-06", null), "ab 6.12.2026");
  assert.equal(periodLabel(null, null), null);
});

test("berlinLocalToDate: Winter- und Sommerzeit, Rückweg ins Feld", () => {
  assert.equal(berlinLocalToDate("2026-12-06T10:00")?.toISOString(), "2026-12-06T09:00:00.000Z");
  assert.equal(berlinLocalToDate("2027-06-01T10:00")?.toISOString(), "2027-06-01T08:00:00.000Z");
  assert.equal(toBerlinLocalInput(new Date("2026-12-06T09:00:00Z")), "2026-12-06T10:00");
  assert.equal(berlinLocalToDate("2026-12-06 10:00"), null);
  assert.equal(berlinLocalToDate("2026-12-06T25:00"), null);
});

test("normalizeHashtags: Raute ergänzen, doppelte weg", () => {
  assert.equal(normalizeHashtags("wakeboard, #tuttenbrocksee  #Wakeboard;beckum"), "#wakeboard #tuttenbrocksee #beckum");
});

test("postCopyText: fehlende Hashtags anhängen", () => {
  assert.equal(postCopyText("Hallo #wakeboard", "#wakeboard #beckum"), "Hallo #wakeboard\n\n#beckum");
  assert.equal(postCopyText("Hallo", null), "Hallo");
  assert.equal(postCopyText("Alles da #a #b", "#a #b"), "Alles da #a #b");
});

test("parseCampaignInput: Kürzel aus dem Namen, Zeitraum geprüft", () => {
  const ok = parseCampaignInput({ name: "Nikolausfahren 2026", startsOn: "2026-12-06", endsOn: "2026-12-06", landingUrl: "https://www.tuttenbrocksee.com/" });
  assert.ok(!("error" in ok));
  if (!("error" in ok)) {
    assert.equal(ok.slug, "nikolausfahren-2026");
    assert.equal(ok.startsOn, "2026-12-06");
    assert.equal(ok.hashtags, null);
  }
  assert.deepEqual(parseCampaignInput({ name: "" }), { error: "Name fehlt" });
  assert.ok("error" in parseCampaignInput({ name: "A", startsOn: "2026-12-06", endsOn: "2026-12-01" }));
  assert.ok("error" in parseCampaignInput({ name: "A", landingUrl: "http://unsicher.de" }));
  assert.ok("error" in parseCampaignInput({ name: "A", slug: "Groß Buchstaben" }));
  const own = parseCampaignInput({ name: "A", slug: "nikolaus-2026" });
  assert.ok(!("error" in own) && own.slug === "nikolaus-2026");
});

test("parsePostInput: Kanal, Textlänge, Bilder, Termin, Zahlen", () => {
  const ok = parsePostInput({
    channel: "INSTAGRAM",
    format: "REEL",
    status: "READY",
    text: "Nikolausfahren!",
    media: ["https://x.public.blob.vercel-storage.com/social/1/a.jpg"],
    plannedAt: "2026-12-06T10:00",
    reach: "1.234",
  });
  assert.ok(!("error" in ok));
  if (!("error" in ok)) {
    assert.equal(ok.plannedAt?.toISOString(), "2026-12-06T09:00:00.000Z");
    assert.equal(ok.reach, 1234);
    assert.equal(ok.clicks, null);
  }
  assert.ok("error" in parsePostInput({ channel: "MYSPACE" }));
  assert.ok("error" in parsePostInput({ channel: "INSTAGRAM", text: "x".repeat(2201) }));
  assert.ok(!("error" in parsePostInput({ channel: "FACEBOOK", text: "x".repeat(2201) })));
  assert.ok("error" in parsePostInput({ channel: "INSTAGRAM", media: ["http://a.de/b.jpg"] }));
  assert.ok("error" in parsePostInput({ channel: "INSTAGRAM", plannedAt: "morgen" }));
  assert.ok("error" in parsePostInput({ channel: "INSTAGRAM", reach: -1 }));
});

test("isOverdue und nextPublishedAt", () => {
  const now = new Date("2026-12-06T12:00:00Z");
  assert.equal(isOverdue({ status: "READY", plannedAt: new Date("2026-12-06T09:00:00Z") }, now), true);
  assert.equal(isOverdue({ status: "PUBLISHED", plannedAt: new Date("2026-12-06T09:00:00Z") }, now), false);
  assert.equal(isOverdue({ status: "IDEA", plannedAt: null }, now), false);
  const planned = new Date("2026-12-06T09:00:00Z");
  assert.equal(nextPublishedAt(null, { status: "PUBLISHED", plannedAt: planned }, now)?.toISOString(), planned.toISOString());
  assert.equal(nextPublishedAt(null, { status: "PUBLISHED", plannedAt: null }, now)?.toISOString(), now.toISOString());
  const before = new Date("2026-12-05T18:00:00Z");
  assert.equal(nextPublishedAt({ status: "PUBLISHED", publishedAt: before }, { status: "PUBLISHED", plannedAt: planned }, now), before);
  assert.equal(nextPublishedAt({ status: "PUBLISHED", publishedAt: before }, { status: "READY", plannedAt: planned }, now), null);
});

test("parsePostInput: automatisch posten nur Instagram/Facebook, Stand Fertig, mit Termin", () => {
  const base = { channel: "INSTAGRAM", status: "READY", plannedAt: "2026-12-06T12:00", autoPublish: true };
  const ok = parsePostInput(base);
  assert.ok(!("error" in ok) && ok.autoPublish === true);
  assert.match((parsePostInput({ ...base, channel: "TIKTOK" }) as { error: string }).error, /Instagram und Facebook/);
  assert.match((parsePostInput({ ...base, status: "DRAFT" }) as { error: string }).error, /Fertig/);
  assert.match((parsePostInput({ ...base, plannedAt: null }) as { error: string }).error, /Termin/);
  const off = parsePostInput({ channel: "TIKTOK", autoPublish: "ja" });
  assert.ok(!("error" in off) && off.autoPublish === false);
});
