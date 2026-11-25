import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBinarytec } from "./binarytec";

type Cfg = { baseUrl: string | null; token: string; extraConfig: string | null } | null;

function fakeDb(cfg: Cfg) {
  let reads = 0;
  return {
    db: { apiConfig: { findFirst: async () => { reads++; return cfg; } } },
    reads: () => reads,
  };
}

function mockFetch(success: boolean, delayMs = 0) {
  const bodies: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("Zeitlimit", "TimeoutError"));
        });
      });
    }
    return new Response(JSON.stringify({ success: success ? 1 : 0 }));
  }) as typeof fetch;
  return { bodies, restore: () => { globalThis.fetch = original; } };
}

const cfg = { baseUrl: "https://binarytec.example.invalid/", token: "x", extraConfig: JSON.stringify({ resourceId: 7 }) };

test("checkBinarytec: ohne Konfiguration oder ohne resourceId null", async () => {
  assert.equal(await checkBinarytec(fakeDb(null).db, 9201, "CODE"), null);
  assert.equal(await checkBinarytec(fakeDb({ ...cfg, extraConfig: "{}" }).db, 9202, "CODE"), null);
});

test("checkBinarytec: Konfiguration wird je Account zwischengespeichert", async () => {
  const f = mockFetch(true);
  try {
    const a = fakeDb(cfg);
    assert.deepEqual(await checkBinarytec(a.db, 9203, " CODE "), { valid: true });
    assert.deepEqual(await checkBinarytec(a.db, 9203, "CODE"), { valid: true });
    assert.equal(a.reads(), 1);
    assert.deepEqual(f.bodies[0], { resourceId: "7", acNumber: "CODE" });
  } finally {
    f.restore();
  }
});

test("checkBinarytec: abgelehnt bleibt abgelehnt", async () => {
  const f = mockFetch(false);
  try {
    assert.deepEqual(await checkBinarytec(fakeDb(cfg).db, 9204, "CODE"), { valid: false });
  } finally {
    f.restore();
  }
});

test("checkBinarytec: nach dem Zeitlimit ungueltig", async () => {
  const f = mockFetch(true, 300);
  try {
    const t0 = Date.now();
    assert.deepEqual(await checkBinarytec(fakeDb(cfg).db, 9205, "CODE", { timeoutMs: 50 }), { valid: false });
    assert.ok(Date.now() - t0 < 250);
  } finally {
    f.restore();
  }
});

test("checkBinarytec: Antwort innerhalb des Zeitlimits zaehlt", async () => {
  const f = mockFetch(true, 20);
  try {
    assert.deepEqual(await checkBinarytec(fakeDb(cfg).db, 9206, "CODE", { timeoutMs: 1000 }), { valid: true });
  } finally {
    f.restore();
  }
});
