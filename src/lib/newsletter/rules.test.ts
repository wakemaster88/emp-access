import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annyGroupPlan, confirmLink, isSnsTopicArn, linkBase, nextConfirmMailCount, parseGroupIds, parseGroupName, readinessGaps,
  reasonLine, subscribeAction, unsubscribeLink,
} from "./rules";

const NOW = new Date("2026-11-27T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const H = 60 * 60 * 1000;

test("subscribeAction: neu, angemeldet, offen, abgemeldet", () => {
  assert.equal(subscribeAction(null, NOW), "create");
  assert.equal(subscribeAction({ status: "ACTIVE", confirmMailSentAt: null, confirmMailCount: 0 }, NOW), "active");
  assert.equal(subscribeAction({ status: "PENDING", confirmMailSentAt: ago(2 * H), confirmMailCount: 1 }, NOW), "resend");
  assert.equal(subscribeAction({ status: "UNSUBSCRIBED", confirmMailSentAt: ago(30 * 24 * H), confirmMailCount: 1 }, NOW), "reopen");
  assert.equal(subscribeAction({ status: "BOUNCED", confirmMailSentAt: null, confirmMailCount: 0 }, NOW), "reopen");
});

test("subscribeAction: höchstens eine Mail je Stunde und fünf je Woche", () => {
  assert.equal(subscribeAction({ status: "PENDING", confirmMailSentAt: ago(10 * 60 * 1000), confirmMailCount: 1 }, NOW), "throttled");
  assert.equal(subscribeAction({ status: "PENDING", confirmMailSentAt: ago(3 * H), confirmMailCount: 5 }, NOW), "throttled");
  assert.equal(subscribeAction({ status: "PENDING", confirmMailSentAt: ago(8 * 24 * H), confirmMailCount: 5 }, NOW), "resend");
});

test("nextConfirmMailCount: zählt hoch, nach einer Woche neu", () => {
  assert.equal(nextConfirmMailCount(null, NOW), 1);
  assert.equal(nextConfirmMailCount({ confirmMailSentAt: ago(2 * H), confirmMailCount: 2 }, NOW), 3);
  assert.equal(nextConfirmMailCount({ confirmMailSentAt: ago(8 * 24 * H), confirmMailCount: 4 }, NOW), 1);
});

test("readinessGaps: alles da = leer", () => {
  assert.deepEqual(readinessGaps({ enabled: true, fromEmail: "a@b.de", hasSesCredentials: true }), []);
  assert.equal(readinessGaps({ enabled: false, fromEmail: null, hasSesCredentials: false }).length, 3);
});

test("linkBase und Links", () => {
  assert.equal(linkBase(null, "https://www.emp-access.de/"), "https://www.emp-access.de/nl");
  assert.equal(linkBase("https://www.tuttenbrocksee.com/newsletter/", "https://x.de"), "https://www.tuttenbrocksee.com/newsletter");
  assert.equal(linkBase("http://unsicher.de", "https://x.de"), "https://x.de/nl");
  assert.equal(confirmLink("https://a.de/nl", "c.1.2.0.3.abc"), "https://a.de/nl/bestaetigen?t=c.1.2.0.3.abc");
  assert.equal(unsubscribeLink("https://a.de/nl", "u.1.2.0.3.abc"), "https://a.de/nl/abmelden?t=u.1.2.0.3.abc");
});

test("isSnsTopicArn", () => {
  assert.ok(isSnsTopicArn("arn:aws:sns:eu-central-1:123456789012:newsletter-events"));
  assert.ok(!isSnsTopicArn("arn:aws:sqs:eu-central-1:123456789012:x"));
  assert.ok(!isSnsTopicArn("newsletter"));
});

test("reasonLine: Text je Herkunft, Abo-Kunden mit Widerspruchshinweis", () => {
  assert.match(reasonLine("Tuttenbrocksee"), /bestellt und die Anmeldung bestätigt/);
  assert.match(reasonLine("Tuttenbrocksee", "website"), /bestätigt/);
  assert.match(reasonLine("Tuttenbrocksee", "import"), /auf der Website von Tuttenbrocksee/);
  assert.doesNotMatch(reasonLine("Tuttenbrocksee", "import"), /bestätigt/);
  assert.match(reasonLine("Tuttenbrocksee", "wakesys"), /zugestimmt/);
  const anny = reasonLine("Tuttenbrocksee", "anny");
  assert.match(anny, /Abo bei Tuttenbrocksee/);
  assert.match(anny, /jederzeit widersprechen/);
  assert.match(anny, /Basistarifen/);
});

test("parseGroupIds: ganze Zahlen, doppelte weg, sonst null", () => {
  assert.deepEqual(parseGroupIds(undefined), []);
  assert.deepEqual(parseGroupIds([3, "1", 3]), [1, 3]);
  assert.equal(parseGroupIds([0]), null);
  assert.equal(parseGroupIds([1.5]), null);
  assert.equal(parseGroupIds("1,2"), null);
  assert.equal(parseGroupIds(Array.from({ length: 51 }, (_, i) => i + 1)), null);
});

test("parseGroupName: getrimmt, Leerzeichen zusammengefasst, höchstens 60 Zeichen", () => {
  assert.deepEqual(parseGroupName("  Cable   Crew "), { name: "Cable Crew" });
  assert.ok("error" in parseGroupName(""));
  assert.ok("error" in parseGroupName("x".repeat(61)));
});

test("annyGroupPlan: neue anlegen, vorhandene zuordnen, Ende des Abos nimmt nur aus der Gruppe", () => {
  const plan = annyGroupPlan(
    [
      { email: "a@x.de", name: null },
      { email: "a@x.de", name: "Anna A" },
      { email: "b@x.de", name: "Ben B" },
      { email: "c@x.de", name: null },
    ],
    [
      { id: 10, email: "b@x.de" },
      { id: 11, email: "c@x.de" },
    ],
    [10, 12],
  );
  assert.deepEqual(plan.create, [{ email: "a@x.de", name: "Anna A" }]);
  assert.deepEqual(plan.memberIds.sort(), [10, 11]);
  assert.deepEqual(plan.removeIds, [12]);
});
