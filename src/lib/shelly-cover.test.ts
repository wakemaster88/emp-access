import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { probeCoverLocally, runCoverAction } from "./shelly-cover";

const CLOUD = { baseUrl: "shelly-77-eu.shelly.cloud", token: "test" };
const ROLLTOR = {
  type: "SHELLY",
  category: "ROLLTOR",
  ipAddress: "192.168.20.41",
  shellyId: "a0b1c2d3e4f5",
  coverUpChannel: 0,
  coverDownChannel: 1,
  coverRuntimeSec: 30,
};

const realFetch = globalThis.fetch;
const realVercel = process.env.VERCEL;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = realVercel;
});

/** fetch unterschieben: jede Anfrage scheitert, die Adressen werden mitgeschrieben. */
function recordFetch(): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
  return urls;
}

test("probeCoverLocally: auf Vercel mit Cloud-Weg kein Statusabruf im LAN", () => {
  assert.equal(probeCoverLocally("192.168.20.41", CLOUD, "a0b1c2d3e4f5", { VERCEL: "1" }), false);
  // Ohne Cloud-Weg bleibt nur das LAN.
  assert.equal(probeCoverLocally("192.168.20.41", null, "a0b1c2d3e4f5", { VERCEL: "1" }), true);
  assert.equal(probeCoverLocally("192.168.20.41", CLOUD, null, { VERCEL: "1" }), true);
  // Hub und lokale Entwicklung: lokal zuerst.
  assert.equal(probeCoverLocally("192.168.20.41", CLOUD, "a0b1c2d3e4f5", {}), true);
  assert.equal(probeCoverLocally(null, CLOUD, "a0b1c2d3e4f5", {}), false);
});

test("runCoverAction: auf Vercel geht keine Anfrage an die LAN-Adresse", async () => {
  process.env.VERCEL = "1";
  const urls = recordFetch();
  const res = await runCoverAction(ROLLTOR, CLOUD, "close");
  assert.equal(res.ok, false);
  assert.ok(urls.length > 0, "Cloud wurde gefragt");
  assert.equal(urls.some((u) => u.includes("192.168.20.41")), false, urls.join(", "));
});

test("runCoverAction: ausserhalb von Vercel wird zuerst im LAN gelesen", async () => {
  delete process.env.VERCEL;
  const urls = recordFetch();
  await runCoverAction(ROLLTOR, { ...CLOUD, token: "test-2" }, "close");
  assert.ok(urls[0]?.includes("192.168.20.41"), urls.join(", "));
});
