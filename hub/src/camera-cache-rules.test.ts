import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAMERA_CACHE_MAX_AGE_DAYS,
  CAMERA_CACHE_REFRESH_MS,
  cacheContent,
  cacheContentKey,
  cacheFileText,
  cacheStamp,
  cacheWriteDue,
  usableCache,
  type CachedCamera,
} from "./camera-cache-rules.js";

const NOW = Date.UTC(2026, 10, 26, 9, 0, 0);
const DAY = 24 * 60 * 60_000;

function cam(over: Record<string, unknown> = {}): CachedCamera {
  return {
    id: 1,
    name: "Einfahrt",
    kind: "REOLINK",
    host: "192.0.2.21",
    httpPort: 80,
    https: false,
    username: "hub",
    password: "beispiel",
    channel: 0,
    ...over,
  } as CachedCamera;
}

const door = (over: Partial<CachedCamera> = {}) =>
  cam({ id: 2, name: "Tor", kind: "DOORBIRD", host: "192.0.2.22", doorHoldUntil: null, ...over });

/** So, wie cameras.ts die Datei liest: Text der Datei, dann JSON.parse. */
const fileAt = (cameras: CachedCamera[], savedAt: number) => JSON.parse(cacheFileText(cameras, savedAt)) as unknown;

test("Kopie bis 14 Tage alt wird geladen, das Alter kommt aus dem Zeitstempel der Datei", () => {
  assert.equal(CAMERA_CACHE_MAX_AGE_DAYS, 14);
  const list = [cam(), door()];
  const fresh = usableCache(fileAt(list, NOW - DAY), NOW, 14);
  assert.equal(fresh.ok, true);
  if (fresh.ok) {
    assert.equal(fresh.savedAt, NOW - DAY);
    assert.deepEqual(
      fresh.cameras.map((c) => c.id),
      [1, 2]
    );
  }
  assert.equal(usableCache(fileAt(list, NOW - 14 * DAY), NOW, 14).ok, true);
  assert.deepEqual(usableCache(fileAt(list, NOW - 14 * DAY - 1), NOW, 14), { ok: false, reason: "älter als 14 Tage" });
  // Die Grenze ist ein Parameter.
  assert.deepEqual(usableCache(fileAt(list, NOW - 3 * DAY), NOW, 2), { ok: false, reason: "älter als 2 Tage" });
  assert.equal(usableCache(fileAt(list, NOW - 3 * DAY), NOW, 0).ok, false);
});

test("Zeitstempel weit nach der Uhr des Hubs: Kopie wird nicht geladen", () => {
  const list = [cam()];
  assert.equal(usableCache(fileAt(list, NOW + 60 * 60_000), NOW, 14).ok, true);
  assert.deepEqual(usableCache(fileAt(list, NOW + 2 * DAY), NOW, 14), {
    ok: false,
    reason: "Zeitstempel liegt in der Zukunft",
  });
});

test("Beschaedigte Datei wird nicht geladen", () => {
  const good = fileAt([cam(), door()], NOW) as Record<string, unknown>;
  const broken: unknown[] = [
    null,
    "text",
    [],
    { ...good, version: 2 },
    { ...good, savedAt: "gestern" },
    { ...good, savedAt: NOW },
    { ...good, cameras: "keine" },
    { ...good, cameras: [cam(), cam()] },
    { ...good, cameras: [cam({ id: 0 })] },
    { ...good, cameras: [cam({ id: "1" })] },
    { ...good, cameras: [cam({ host: null })] },
    { ...good, cameras: [cam({ httpPort: 70_000 })] },
    { ...good, cameras: [cam({ https: "nein" })] },
    { ...good, cameras: [cam({ password: undefined })] },
    { ...good, cameras: [cam({ channel: -1 })] },
    { ...good, cameras: [cam(), null] },
  ];
  for (const raw of broken) {
    assert.deepEqual(usableCache(raw, NOW, 14), { ok: false, reason: "beschädigt" }, JSON.stringify(raw));
  }
  // Eine leere Liste ist eine gueltige Antwort der Cloud.
  assert.deepEqual(usableCache(fileAt([], NOW), NOW, 14), { ok: true, savedAt: NOW, cameras: [] });
});

test("Aus der Kopie wird nichts geschaltet: kein Offenhalten, Lieferdienst nur melden", () => {
  const list = [
    cam({ deliveryMode: "OPEN" }),
    cam({ id: 3, deliveryMode: "NOTIFY" }),
    cam({ id: 4, deliveryMode: null }),
    door({ doorHoldUntil: new Date(NOW + 60 * 60_000).toISOString() }),
  ];
  // Schon die Datei enthaelt kein Offenhalten.
  const raw = fileAt(list, NOW - DAY) as { cameras: Record<string, unknown>[] };
  assert.equal(
    raw.cameras.some((c) => "doorHoldUntil" in c),
    false
  );
  // Und auch eine Datei, in der doch eines stuende, liefert keines.
  raw.cameras[3].doorHoldUntil = new Date(NOW + 60 * 60_000).toISOString();
  const r = usableCache(raw, NOW, 14);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(
    r.cameras.map((c) => [c.id, c.deliveryMode ?? null, c.doorHoldUntil]),
    [
      [1, "NOTIFY", null],
      [3, "NOTIFY", null],
      [4, null, null],
      [2, null, null],
    ]
  );
  // Uebrige Felder bleiben, wie die Cloud sie geliefert hat.
  assert.equal(r.cameras[0].password, "beispiel");
});

test("Inhalt ohne Offenhalten: Start oder Ende eines Offenhaltens aendert die Kopie nicht", () => {
  const a = [door({ doorHoldUntil: null })];
  const b = [door({ doorHoldUntil: new Date(NOW + 60 * 60_000).toISOString() })];
  assert.equal(cacheContentKey(a), cacheContentKey(b));
  assert.equal("doorHoldUntil" in cacheContent(b)[0], false);
  // Die Antwort der Cloud selbst bleibt unveraendert.
  assert.equal(typeof b[0].doorHoldUntil, "string");
  assert.notEqual(cacheContentKey(a), cacheContentKey([door({ host: "192.0.2.23" })]));
});

test("Neu geschrieben wird bei geaendertem Inhalt und sonst einmal am Tag", () => {
  const list = [cam(), door()];
  const content = cacheContentKey(list);
  assert.equal(cacheWriteDue(null, content, NOW), true);
  const stamp = cacheStamp(fileAt(list, NOW));
  assert.deepEqual(stamp, { content, savedAt: NOW });
  assert.equal(cacheWriteDue(stamp, content, NOW + 60_000), false);
  assert.equal(cacheWriteDue(stamp, content, NOW + CAMERA_CACHE_REFRESH_MS - 1), false);
  assert.equal(cacheWriteDue(stamp, content, NOW + CAMERA_CACHE_REFRESH_MS), true);
  assert.equal(cacheWriteDue(stamp, cacheContentKey([cam()]), NOW + 60_000), true);
  // Uhr des Hubs zurueckgestellt: den Zeitstempel nicht in der Zukunft stehen lassen.
  assert.equal(cacheWriteDue(stamp, content, NOW - 60_000), true);
  // Eine beschaedigte vorhandene Datei zaehlt wie keine.
  assert.equal(cacheStamp({ version: 1 }), null);
});
