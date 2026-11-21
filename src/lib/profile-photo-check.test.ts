import { test } from "node:test";
import assert from "node:assert/strict";
import { checkProfilePhoto, parseVerdict, pickVisionModel } from "./profile-photo-check";

const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";

test("parseVerdict: JSON, Text drumherum, unbekannt", () => {
  assert.equal(parseVerdict('{"verdict":"ok"}'), "ok");
  assert.equal(parseVerdict('Hier: ```json\n{"verdict": "multiple_people"}\n```'), "multiple_people");
  assert.equal(parseVerdict("no_person"), "no_person");
  assert.equal(parseVerdict('{"verdict":"vielleicht"}'), null);
  assert.equal(parseVerdict(""), null);
});

test("pickVisionModel: schnell vor langsam, keine Bildgeneratoren", () => {
  assert.equal(pickVisionModel([]), null);
  assert.equal(pickVisionModel(["grok-4.7", "grok-4.7-fast-non-reasoning", "grok-imagine-image"]), "grok-4.7-fast-non-reasoning");
});

function withFetch(answer: (url: string) => Response, run: () => Promise<void>) {
  return async () => {
    const realFetch = globalThis.fetch;
    const realKey = process.env.XAI_API_KEY;
    const realModel = process.env.XAI_VISION_MODEL;
    const realError = console.error;
    process.env.XAI_API_KEY = "test";
    process.env.XAI_VISION_MODEL = "grok-test";
    console.error = () => {};
    globalThis.fetch = (async (input: RequestInfo | URL) => answer(String(input))) as typeof fetch;
    try {
      await run();
    } finally {
      globalThis.fetch = realFetch;
      console.error = realError;
      if (realKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = realKey;
      if (realModel === undefined) delete process.env.XAI_VISION_MODEL; else process.env.XAI_VISION_MODEL = realModel;
    }
  };
}

test("checkProfilePhoto: ungeeignetes Bild wird mit deutschem Satz abgelehnt", withFetch(
  () => Response.json({ output: [{ content: [{ type: "output_text", text: '{"verdict":"no_person"}' }] }] }),
  async () => {
    const r = await checkProfilePhoto(JPG);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.error.includes("keine Person"));
  }
));

test("checkProfilePhoto: geeignetes Bild geht durch", withFetch(
  () => Response.json({ output_text: '{"verdict":"ok"}' }),
  async () => assert.deepEqual(await checkProfilePhoto(JPG), { ok: true, checked: true })
));

test("checkProfilePhoto: Ausfall der KI blockiert nicht", withFetch(
  () => new Response("kaputt", { status: 500 }),
  async () => assert.deepEqual(await checkProfilePhoto(JPG), { ok: true, checked: false })
));

test("checkProfilePhoto: ohne Schlüssel keine Prüfung", async () => {
  const realKey = process.env.XAI_API_KEY;
  delete process.env.XAI_API_KEY;
  try {
    assert.deepEqual(await checkProfilePhoto(JPG), { ok: true, checked: false });
  } finally {
    if (realKey !== undefined) process.env.XAI_API_KEY = realKey;
  }
});
