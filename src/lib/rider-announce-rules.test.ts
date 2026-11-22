import { test } from "node:test";
import assert from "node:assert/strict";
import {
  challengeAnnounceBlock,
  challengePushText,
  isTestTitle,
  offerAnnounceBlock,
  offerPushText,
} from "./rider-announce-rules";
import { pushPlanPatch } from "./gamification-input";

const offer = { title: "Feierabend-Stunde", active: true, fromYmd: null, toYmd: null, pushPlanned: true, pushedAt: null };
const challenge = { name: "5 Besuchstage", active: true, startYmd: "2026-11-20", endYmd: "2026-11-30", pushPlanned: true, pushedAt: null };

test("TEST:-Einträge gehen nie raus", () => {
  assert.equal(isTestTitle("TEST: Freigetränk"), true);
  assert.equal(isTestTitle("  test : x"), true);
  assert.equal(isTestTitle("Testfahrt am Sonntag"), false);
  assert.equal(offerAnnounceBlock({ ...offer, title: "TEST: Probe" }, "2026-11-20", 12), "test");
  assert.equal(challengeAnnounceBlock({ ...challenge, name: "Test: Probe" }, "2026-11-20", 12), "test");
});

test("Angebot: sofort, wenn sichtbar und tagsüber", () => {
  assert.equal(offerAnnounceBlock(offer, "2026-11-20", 12), null);
  assert.equal(offerAnnounceBlock({ ...offer, pushPlanned: false }, "2026-11-20", 12), "not-planned");
  assert.equal(offerAnnounceBlock({ ...offer, active: false }, "2026-11-20", 12), "off");
  assert.equal(offerAnnounceBlock({ ...offer, pushedAt: new Date() }, "2026-11-20", 12), "sent");
});

test("Angebot: wartet bis zum ersten sichtbaren Tag, nach dem Ende nie", () => {
  assert.equal(offerAnnounceBlock({ ...offer, fromYmd: "2026-11-25" }, "2026-11-20", 12), "not-yet");
  assert.equal(offerAnnounceBlock({ ...offer, fromYmd: "2026-11-25" }, "2026-11-25", 12), null);
  assert.equal(offerAnnounceBlock({ ...offer, toYmd: "2026-11-19" }, "2026-11-20", 12), "over");
});

test("Nachts wird nicht gesendet", () => {
  assert.equal(offerAnnounceBlock(offer, "2026-11-20", 8), "night");
  assert.equal(offerAnnounceBlock(offer, "2026-11-20", 9), null);
  assert.equal(offerAnnounceBlock(offer, "2026-11-20", 21), "night");
  assert.equal(challengeAnnounceBlock(challenge, "2026-11-20", 23), "night");
});

test("Challenge: auch vor dem Start melden, nach dem Ende nicht", () => {
  assert.equal(challengeAnnounceBlock({ ...challenge, startYmd: "2026-12-01", endYmd: "2026-12-31" }, "2026-11-20", 12), null);
  assert.equal(challengeAnnounceBlock({ ...challenge, endYmd: "2026-11-19" }, "2026-11-20", 12), "over");
  assert.equal(challengeAnnounceBlock({ ...challenge, active: false }, "2026-11-20", 12), "off");
});

test("Texte der Nachricht", () => {
  assert.deepEqual(offerPushText({ title: "Feierabend", text: "Ab 18 Uhr Leihbrett gratis", toYmd: "2026-11-30" }), {
    title: "Neues Angebot: Feierabend",
    body: "Ab 18 Uhr Leihbrett gratis. Gilt bis 30.11.",
  });
  assert.equal(offerPushText({ title: "X", text: null, toYmd: null }).body, "Schau in der App vorbei.");
  // News: Titel ohne „Neues Angebot“, kein „Gilt bis“.
  assert.deepEqual(
    offerPushText({ title: "Neue Öffnungszeiten", text: "Morgen wetterbedingt geschlossen!", toYmd: "2026-11-23", kind: "NEWS" }),
    { title: "Neue Öffnungszeiten", body: "Morgen wetterbedingt geschlossen!" },
  );
  const base = {
    name: "November-Grind", description: null, kind: "TASK" as const, metric: "VISIT_DAYS" as const,
    threshold: 5, topCount: null, startYmd: "2026-11-20", endYmd: "2026-11-30", voucherLabel: "Freigetränk",
  };
  const running = challengePushText(base, "2026-11-20");
  assert.equal(running.title, "Neue Challenge: November-Grind");
  assert.match(running.body, /Gewinn: Freigetränk\. Läuft bis 30\.11\.$/);
  assert.match(challengePushText({ ...base, startYmd: "2026-12-01" }, "2026-11-20").body, /Startet am 01\.12\.$/);
  const oneDay = { ...base, startYmd: "2026-12-06", endYmd: "2026-12-06", endTime: "18:00" };
  assert.match(challengePushText(oneDay, "2026-11-22").body, /Am 06\.12\. bis 18 Uhr$/);
  assert.match(challengePushText({ ...base, endTime: "18:30" }, "2026-11-20").body, /Läuft bis 30\.11\., 18:30 Uhr$/);
});

test("Push-Plan: Bearbeiten ohne Schalter ändert nichts, gesendet bleibt gesendet", () => {
  assert.deepEqual(pushPlanPatch(undefined, null), {});
  assert.deepEqual(pushPlanPatch(true, null), { pushPlanned: true });
  assert.deepEqual(pushPlanPatch(false, null), { pushPlanned: false });
  assert.deepEqual(pushPlanPatch(true, new Date()), {});
});
