import { test } from "node:test";
import assert from "node:assert/strict";
import {
  freeAt,
  grantValid,
  isSkillDevice,
  normalizeSkillReward,
  pickGrant,
  runText,
  skillBlock,
  skillBlockText,
  skillRunSeconds,
  type SkillCheckInput,
} from "./rider-skill-rules";
import { decideZone } from "./music-vote-rules";

const now = new Date("2026-07-04T12:00:00Z");
const base: SkillCheckInput = {
  skill: { paused: false, onlyOperating: true, onlyOnSite: true, cooldownMinutes: 2 },
  left: 3,
  hasTarget: true,
  liftOpen: true,
  startedToday: true,
  lastUse: null,
  now,
};

test("Skills schalten nur Taster, Schalter, Licht und Hue, nie Türen oder Ventile", () => {
  assert.equal(isSkillDevice({ type: "SHELLY", category: "TASTER" }), true);
  assert.equal(isSkillDevice({ type: "SHELLY", category: "SCHALTER" }), true);
  assert.equal(isSkillDevice({ type: "SHELLY", category: "BELEUCHTUNG" }), true);
  assert.equal(isSkillDevice({ type: "HUE_LIGHT", category: "BELEUCHTUNG" }), true);
  assert.equal(isSkillDevice({ type: "SHELLY", category: "TUER" }), false);
  assert.equal(isSkillDevice({ type: "SHELLY", category: "DREHKREUZ" }), false);
  assert.equal(isSkillDevice({ type: "SHELLY", category: "ROLLTOR" }), false);
  assert.equal(isSkillDevice({ type: "SHELLY", category: null }), false);
  assert.equal(isSkillDevice({ type: "GARDENA_VALVE", category: "SCHALTER" }), false);
  assert.equal(isSkillDevice({ type: "NUKI_SMARTLOCK", category: "TUER" }), false);
  assert.equal(isSkillDevice({ type: "RASPBERRY_PI", category: "DREHKREUZ" }), false);
});

test("Taster läuft seine eigene Dauer, sonst die Minuten des Skills (höchstens 30)", () => {
  assert.equal(skillRunSeconds({ kind: "DEVICE", minutes: 5 }, { category: "TASTER", pulseSeconds: 60 }), 60);
  assert.equal(skillRunSeconds({ kind: "DEVICE", minutes: 5 }, { category: "SCHALTER", pulseSeconds: null }), 300);
  assert.equal(skillRunSeconds({ kind: "MUSIC", minutes: 99 }, null), 1800);
  assert.equal(runText(60), "60 Sek.");
  assert.equal(runText(300), "5 Min.");
});

test("Taste frei, wenn alle Grenzen passen", () => {
  assert.equal(skillBlock(base), null);
});

test("Grenzen: verbraucht, gesperrt, geschlossen, nicht vor Ort", () => {
  assert.equal(skillBlock({ ...base, left: 0 })?.kind, "used-up");
  assert.equal(skillBlock({ ...base, hasTarget: false })?.kind, "no-target");
  assert.equal(skillBlock({ ...base, skill: { ...base.skill, paused: true } })?.kind, "paused");
  assert.equal(skillBlock({ ...base, liftOpen: false })?.kind, "closed");
  assert.equal(skillBlock({ ...base, startedToday: false })?.kind, "not-on-site");
  // Ohne die Häkchen gelten die Grenzen nicht.
  assert.equal(
    skillBlock({ ...base, liftOpen: false, startedToday: false, skill: { ...base.skill, onlyOperating: false, onlyOnSite: false } }),
    null,
  );
});

test("Läuft noch, dann Pause, dann wieder frei", () => {
  const at = new Date(now.getTime() - 30_000);
  const running = skillBlock({ ...base, lastUse: { at, until: new Date(now.getTime() + 30_000) } });
  assert.equal(running?.kind, "running");
  const cooling = skillBlock({ ...base, lastUse: { at: new Date(now.getTime() - 90_000), until: new Date(now.getTime() - 30_000) } });
  assert.equal(cooling?.kind, "cooldown");
  assert.equal(cooling && "until" in cooling ? cooling.until.toISOString() : null, "2026-07-04T12:01:30.000Z");
  const free = skillBlock({ ...base, lastUse: { at: new Date(now.getTime() - 300_000), until: new Date(now.getTime() - 240_000) } });
  assert.equal(free, null);
  assert.equal(freeAt({ at, until: null }, 0).getTime(), at.getTime());
});

test("Texte für die App", () => {
  assert.match(skillBlockText({ kind: "cooldown", until: new Date("2026-07-04T12:05:00Z") }), /14:05/);
  assert.equal(skillBlockText({ kind: "not-on-site" }), "Geht, sobald du heute am Lift gestartet bist.");
});

test("Vergabe mit dem frühesten Ablauf wird zuerst verbraucht", () => {
  const grants = [
    { id: 1, uses: 5, usedCount: 1, expiresAt: null },
    { id: 2, uses: 1, usedCount: 0, expiresAt: new Date("2026-08-01T00:00:00Z") },
    { id: 3, uses: 1, usedCount: 1, expiresAt: new Date("2026-07-10T00:00:00Z") },
  ];
  assert.equal(pickGrant(grants)?.id, 2);
  assert.equal(pickGrant([grants[2]]), null);
  assert.equal(grantValid({ disabledAt: null, expiresAt: new Date("2026-07-01T00:00:00Z") }, now), false);
  assert.equal(grantValid({ disabledAt: now, expiresAt: null }, now), false);
});

test("Belohnung: leer heißt ohne Skill, fehlende Felder bleiben, Nutzungen begrenzt", () => {
  assert.deepEqual(normalizeSkillReward({}), {});
  assert.deepEqual(normalizeSkillReward({ skillId: null }), { skillId: null, skillUses: 1, skillValidDays: null });
  assert.deepEqual(normalizeSkillReward({ skillId: 4, skillUses: 500, skillValidDays: 30 }), { skillId: 4, skillUses: 100, skillValidDays: 30 });
});

test("Musik-Joker hält die Abstimmung an, solange er läuft", () => {
  const zone = {
    isActive: true, deviceId: 1, isPlaying: true, externalActive: null, sourceKind: "PLAYLIST",
    playlistId: 1, streamId: null, staffChoiceAt: null,
  };
  assert.deepEqual(decideZone({ ...zone, riderChoiceUntil: new Date(now.getTime() + 60_000) }, "p2", 60, now), { kind: "idle", reason: "rider-skill" });
  assert.deepEqual(decideZone({ ...zone, riderChoiceUntil: new Date(now.getTime() - 60_000) }, "p2", 60, now), { kind: "switch", option: "p2" });
});
