import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWakesys } from "./wakesys";

type Cfg = { baseUrl: string | null; extraConfig: string | null } | null;

function fakeDb(cfg: Cfg) {
  let reads = 0;
  return {
    db: { apiConfig: { findFirst: async () => { reads++; return cfg; } } },
    reads: () => reads,
  };
}

/** fetch-Ersatz: antwortet je Schnittstelle, wartet optional und bricht bei Abbruch-Signal ab. */
function mockFetch(answer: (iface: string) => { valid: boolean } | "error", delayMs = 0) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const iface = new URL(String(input)).searchParams.get("interface_id") ?? "";
    calls.push(iface);
    if (delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("Zeitlimit", "TimeoutError"));
        });
      });
    }
    const a = answer(iface);
    if (a === "error") return new Response("kein JSON", { status: 500 });
    const value = a.valid ? { card_valid: "yes", col_first_name: "Vor", col_last_name: "Nach" } : { card_valid: "no" };
    return new Response(JSON.stringify({ data: { value } }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const cfg = { baseUrl: null, extraConfig: JSON.stringify({ account: "test", interfaceIds: [1, 2] }) };

test("checkWakesys: ohne Konfiguration null", async () => {
  const { db } = fakeDb(null);
  assert.equal(await checkWakesys(db, 9101, "CODE"), null);
});

test("checkWakesys: Konfiguration wird je Account zwischengespeichert", async () => {
  const f = mockFetch(() => ({ valid: false }));
  try {
    const a = fakeDb(cfg);
    await checkWakesys(a.db, 9102, "CODE");
    await checkWakesys(a.db, 9102, "CODE");
    assert.equal(a.reads(), 1);
    const b = fakeDb(cfg);
    await checkWakesys(b.db, 9103, "CODE");
    assert.equal(b.reads(), 1);
  } finally {
    f.restore();
  }
});

test("checkWakesys: Schnittstellen nacheinander, erster Treffer gewinnt", async () => {
  const f = mockFetch((iface) => ({ valid: iface === "1" }));
  try {
    const r = await checkWakesys(fakeDb(cfg).db, 9104, "CODE");
    assert.deepEqual(r, { valid: true, interfaceId: 1, name: "Vor Nach", picture: undefined, age: undefined });
    assert.deepEqual(f.calls, ["1"]);
  } finally {
    f.restore();
  }
});

test("checkWakesys: zweite Schnittstelle, wenn die erste den Code nicht kennt", async () => {
  const f = mockFetch((iface) => ({ valid: iface === "2" }));
  try {
    const r = await checkWakesys(fakeDb(cfg).db, 9105, "CODE");
    assert.equal(r?.valid, true);
    assert.deepEqual(f.calls, ["1", "2"]);
  } finally {
    f.restore();
  }
});

test("checkWakesys: Fehlerantwort beendet die Pruefung wie bisher", async () => {
  const f = mockFetch((iface) => (iface === "1" ? "error" : { valid: true }));
  try {
    assert.deepEqual(await checkWakesys(fakeDb(cfg).db, 9106, "CODE"), { valid: false });
    assert.deepEqual(f.calls, ["1"]);
  } finally {
    f.restore();
  }
});

test("checkWakesys: Zeitlimit gilt fuer alle Abrufe zusammen", async () => {
  const f = mockFetch(() => ({ valid: false }), 80);
  try {
    const t0 = Date.now();
    assert.deepEqual(await checkWakesys(fakeDb(cfg).db, 9107, "CODE", { timeoutMs: 120 }), { valid: false });
    const ms = Date.now() - t0;
    assert.ok(ms < 400, `dauerte ${ms} ms`);
    assert.deepEqual(f.calls, ["1", "2"]);
  } finally {
    f.restore();
  }
});

test("checkWakesys: Antwort innerhalb des Zeitlimits zaehlt", async () => {
  const f = mockFetch((iface) => ({ valid: iface === "2" }), 30);
  try {
    const r = await checkWakesys(fakeDb(cfg).db, 9108, "CODE", { timeoutMs: 1000 });
    assert.equal(r?.valid, true);
  } finally {
    f.restore();
  }
});
