import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LINK_RULE_CHANGES_KEPT,
  LINK_RULES_OFF,
  diffLinkRules,
  hideMonitorNames,
  kioskDoorAllowed,
  kioskVisibleDoors,
  monitorDeviceIdList,
  mayUseMobileEmergency,
  mergeLinkRulesPatch,
  mobileActionNeedsGrant,
  parseLinkRuleChanges,
  parseLinkRules,
  type LinkRules,
} from "./link-rules";

const on = (patch: Partial<LinkRules>): LinkRules => ({ ...LINK_RULES_OFF, ...patch });

test("parseLinkRules: alles Fehlende oder Kaputte ist aus", () => {
  for (const raw of [null, undefined, "x", 3, [], [true], {}]) {
    assert.deepEqual(parseLinkRules(raw), LINK_RULES_OFF);
  }
  for (const key of Object.keys(LINK_RULES_OFF)) {
    for (const v of ["true", 1, null, {}]) {
      assert.equal(parseLinkRules({ [key]: v })[key as keyof LinkRules], false, `${key}=${String(v)}`);
    }
    assert.equal(parseLinkRules({ [key]: true })[key as keyof LinkRules], true, key);
  }
});

test("parseLinkRules: Einlass-Regeln im selben JSON stören nicht", () => {
  const r = parseLinkRules({ readerNeedsArea: true, passbackMinutes: 10, changes: [], mobileEmergencyNeedsGrant: true });
  assert.deepEqual(r, on({ mobileEmergencyNeedsGrant: true }));
});

test("parseLinkRuleChanges: nur lesbare Einträge, eigener Verlauf", () => {
  const changes = parseLinkRuleChanges({
    changes: [{ at: "2026-11-24T10:00:00.000Z", key: "readerNeedsArea", from: false, to: true }],
    linkChanges: [
      { at: "2026-11-24T10:00:00.000Z", adminId: "7", admin: "admin@example.invalid", key: "mobileEmergencyNeedsGrant", from: false, to: true },
      { at: "2026-11-24T10:00:00.000Z", key: "readerNeedsArea", from: false, to: true },
      { at: "2026-11-24T10:00:00.000Z", key: "mobileEmergencyNeedsGrant", from: 0, to: 1 },
      "kaputt",
    ],
  });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].admin, "admin@example.invalid");
  assert.deepEqual(parseLinkRuleChanges(null), []);
});

test("diffLinkRules: nur geänderte Schalter", () => {
  assert.deepEqual(diffLinkRules(LINK_RULES_OFF, LINK_RULES_OFF), []);
  assert.deepEqual(diffLinkRules(LINK_RULES_OFF, on({ mobileEmergencyNeedsGrant: true })), [
    { key: "mobileEmergencyNeedsGrant", from: false, to: true },
  ]);
});

test("mobileActionNeedsGrant: NOT-AUF immer, Sperren außer Smart Lock und Antrieb", () => {
  const turnstile = { type: "RASPBERRY_PI", category: "DREHKREUZ" };
  const shellyDoor = { type: "SHELLY", category: "TUER" };
  const loqed = { type: "LOQED_SMARTLOCK", category: "TUER" };
  const nuki = { type: "NUKI_SMARTLOCK", category: null };
  const cover = { type: "SHELLY", category: "MARKISE" };
  const light = { type: "SHELLY", category: "BELEUCHTUNG" };
  for (const d of [turnstile, shellyDoor, loqed, nuki, cover, light]) {
    assert.equal(mobileActionNeedsGrant("emergency", d), true);
    assert.equal(mobileActionNeedsGrant("open", d), false);
    assert.equal(mobileActionNeedsGrant("reset", d), false);
    assert.equal(mobileActionNeedsGrant("stop", d), false);
    assert.equal(mobileActionNeedsGrant("close", d), false);
  }
  assert.equal(mobileActionNeedsGrant("deactivate", turnstile), true);
  assert.equal(mobileActionNeedsGrant("deactivate", shellyDoor), true);
  assert.equal(mobileActionNeedsGrant("deactivate", light), true);
  // „Abschließen“ am Smart Lock und „Stopp“ am Antrieb bleiben für alle.
  assert.equal(mobileActionNeedsGrant("deactivate", loqed), false);
  assert.equal(mobileActionNeedsGrant("deactivate", nuki), false);
  assert.equal(mobileActionNeedsGrant("deactivate", cover), false);
});

test("mayUseMobileEmergency: Regel aus erlaubt jedem, Regel an nur mit Haken", () => {
  assert.equal(mayUseMobileEmergency(LINK_RULES_OFF, false), true);
  assert.equal(mayUseMobileEmergency(LINK_RULES_OFF, true), true);
  const r = on({ mobileEmergencyNeedsGrant: true });
  assert.equal(mayUseMobileEmergency(r, false), false);
  assert.equal(mayUseMobileEmergency(r, true), true);
});

test("monitorDeviceIdList: nur ganze positive Zahlen", () => {
  assert.deepEqual(monitorDeviceIdList([1, "2", 0, -1, 1.5, null, "x"]), [1, 2]);
  assert.deepEqual(monitorDeviceIdList(null), []);
  assert.deepEqual(monitorDeviceIdList({ a: 1 }), []);
});

test("Kiosk: Regel aus zeigt und öffnet alle Türen wie bisher", () => {
  const doors = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.equal(kioskVisibleDoors(LINK_RULES_OFF, doors, [2]), doors);
  assert.equal(kioskVisibleDoors(LINK_RULES_OFF, doors, []), doors);
  for (const id of [1, 2, 3, 99]) assert.equal(kioskDoorAllowed(LINK_RULES_OFF, [2], id), true);
  assert.equal(kioskDoorAllowed(LINK_RULES_OFF, null, 1), true);
});

test("Kiosk: Regel an nur zugeordnete Türen", () => {
  const r = on({ kioskDoorsAssignedOnly: true });
  const doors = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(kioskVisibleDoors(r, doors, [2, 3, 7]), [{ id: 2 }, { id: 3 }]);
  assert.deepEqual(kioskVisibleDoors(r, doors, []), []);
  assert.deepEqual(kioskVisibleDoors(r, doors, null), []);
  assert.equal(kioskDoorAllowed(r, [2], 2), true);
  assert.equal(kioskDoorAllowed(r, ["2"], 2), true);
  assert.equal(kioskDoorAllowed(r, [2], 1), false);
  assert.equal(kioskDoorAllowed(r, [], 1), false);
});

test("hideMonitorNames: Regel aus unverändert, Regel an leere Namen", () => {
  const resources = [
    { id: 1, name: "Bereich", slots: [{ start: "10:00", count: 2, names: ["A", "B"] }, { start: "11:00", count: 0, names: [] }] },
  ];
  assert.equal(hideMonitorNames(LINK_RULES_OFF, resources), resources);
  const hidden = hideMonitorNames(on({ monitorHideNames: true }), resources);
  assert.deepEqual(hidden, [
    { id: 1, name: "Bereich", slots: [{ start: "10:00", count: 2, names: [] }, { start: "11:00", count: 0, names: [] }] },
  ]);
  // Das Original bleibt unverändert.
  assert.deepEqual(resources[0].slots[0].names, ["A", "B"]);
});

test("riderShortIntro: Zeiten in rider.css und rider-intro.tsx passen zusammen", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../app/(rider)/app/rider.css", import.meta.url), "utf8");
  const tsx = readFileSync(new URL("../components/rider/rider-intro.tsx", import.meta.url), "utf8");
  const sec = (re: RegExp, src: string) => {
    const m = src.match(re);
    assert.ok(m, String(re));
    return Number(m[1]);
  };
  // Lang: Ausblenden 0,35 s nach 0,95 s, Timer kurz danach.
  const longEnd = sec(/rd-intro-out 0\.35s [^;]* (\d+\.\d+)s forwards/, css) + 0.35;
  const shortDur = sec(/\.rd-intro\.rd-intro-short \{ animation-duration: (\d+\.\d+)s/, css);
  const shortDelay = sec(/\.rd-intro\.rd-intro-short \{[^}]*animation-delay: (\d+\.\d+)s/, css);
  const shortEnd = shortDelay + shortDur;
  assert.equal(Math.round(longEnd * 100), 130);
  assert.equal(Math.round(shortEnd * 100), 65);
  const doneMs = sec(/const DONE_MS = (\d+);/, tsx);
  const doneShortMs = sec(/const DONE_MS_SHORT = (\d+);/, tsx);
  assert.ok(doneMs >= longEnd * 1000 && doneMs - longEnd * 1000 <= 150);
  assert.ok(doneShortMs >= shortEnd * 1000 && doneShortMs - shortEnd * 1000 <= 100);
});

test("mergeLinkRulesPatch: legt die Änderung über den gelesenen Stand und ergänzt den Verlauf", () => {
  const who = { at: "2026-11-25T10:00:00.000Z", adminId: "7", admin: "a@example.org" };
  // Noch nie gespeichert.
  const first = mergeLinkRulesPatch(null, { monitorHideNames: true }, who);
  assert.deepEqual(first.links, on({ monitorHideNames: true }));
  assert.deepEqual(first.newLinkChanges, [{ ...who, key: "monitorHideNames", from: false, to: true }]);
  assert.deepEqual(first.linkChanges, first.newLinkChanges);

  // Zweite Änderung auf dem gespeicherten Stand: die erste bleibt erhalten.
  const stored = { ...first.links, linkChanges: first.linkChanges };
  const later = { ...who, at: "2026-11-25T10:01:00.000Z" };
  const second = mergeLinkRulesPatch(stored, { riderShortIntro: true, monitorHideNames: true }, later);
  assert.deepEqual(second.links, on({ monitorHideNames: true, riderShortIntro: true }));
  assert.deepEqual(second.newLinkChanges.map((c) => c.key), ["riderShortIntro"]);
  assert.deepEqual(second.linkChanges.map((c) => c.key), ["riderShortIntro", "monitorHideNames"]);

  // Mehrere Schlüssel auf einmal: neueste vorn, in umgekehrter Reihenfolge von LINK_RULE_KEYS.
  const multi = mergeLinkRulesPatch(null, { mobileEmergencyNeedsGrant: true, resumeOnlyOwnPause: true }, who);
  assert.deepEqual(multi.newLinkChanges.map((c) => c.key), ["mobileEmergencyNeedsGrant", "resumeOnlyOwnPause"]);
  assert.deepEqual(multi.linkChanges.map((c) => c.key), ["resumeOnlyOwnPause", "mobileEmergencyNeedsGrant"]);

  // Ohne Änderung nichts Neues, Verlauf unverändert.
  const same = mergeLinkRulesPatch(stored, { monitorHideNames: true, kioskDoorsAssignedOnly: false }, who);
  assert.deepEqual(same.newLinkChanges, []);
  assert.deepEqual(same.linkChanges, first.linkChanges);

  // Verlauf auf LINK_RULE_CHANGES_KEPT gekürzt, die neue Änderung vorn.
  const long = Array.from({ length: LINK_RULE_CHANGES_KEPT }, () => ({ ...who, key: "monitorHideNames", from: false, to: true }));
  const cut = mergeLinkRulesPatch({ linkChanges: long }, { kioskDoorsAssignedOnly: true }, later);
  assert.equal(cut.linkChanges.length, LINK_RULE_CHANGES_KEPT);
  assert.equal(cut.linkChanges[0].key, "kioskDoorsAssignedOnly");
  assert.equal(cut.linkChanges[0].at, later.at);

  // Schlüssel der Einlass-Regeln im Patch werden hier nicht beachtet.
  const foreign = mergeLinkRulesPatch(null, { readerNeedsArea: true } as unknown as Partial<LinkRules>, who);
  assert.deepEqual(foreign.links, LINK_RULES_OFF);
  assert.deepEqual(foreign.newLinkChanges, []);
});
