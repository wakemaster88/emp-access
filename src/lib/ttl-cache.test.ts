import { test } from "node:test";
import assert from "node:assert/strict";
import { createTtlCache } from "./ttl-cache";

test("createTtlCache: Treffer innerhalb der Frist, danach neu laden", async () => {
  let t = 1000;
  const cache = createTtlCache<number>(100, { now: () => t });
  let calls = 0;
  const load = async () => ++calls;

  assert.equal(await cache.get("a", load), 1);
  t = 1099;
  assert.equal(await cache.get("a", load), 1);
  t = 1100;
  assert.equal(await cache.get("a", load), 2);
  assert.equal(calls, 2);
});

test("createTtlCache: Schluessel sind getrennt", async () => {
  const cache = createTtlCache<string>(1000);
  assert.equal(await cache.get("a", async () => "A"), "A");
  assert.equal(await cache.get("b", async () => "B"), "B");
  assert.equal(await cache.get("a", async () => "X"), "A");
});

test("createTtlCache: gleichzeitige Aufrufe teilen einen Abruf", async () => {
  const cache = createTtlCache<number>(1000);
  let calls = 0;
  const load = () => new Promise<number>((r) => setTimeout(() => r(++calls), 5));
  const [x, y] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
  assert.equal(x, 1);
  assert.equal(y, 1);
  assert.equal(calls, 1);
});

test("createTtlCache: Fehler wird nicht gespeichert", async () => {
  const cache = createTtlCache<number>(1000);
  await assert.rejects(cache.get("k", async () => { throw new Error("weg"); }));
  assert.equal(await cache.get("k", async () => 7), 7);
});

test("createTtlCache: begrenzt die Zahl der Eintraege", async () => {
  const cache = createTtlCache<number>(10_000, { maxEntries: 3 });
  for (let i = 0; i < 10; i++) await cache.get(`k${i}`, async () => i);
  assert.ok(cache.size <= 3);
  // juengster Eintrag bleibt erhalten
  assert.equal(await cache.get("k9", async () => -1), 9);
});
