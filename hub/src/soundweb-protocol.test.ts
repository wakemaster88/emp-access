/**
 * London-DI-Rahmen (soundweb-protocol.ts) auf Byte-Ebene: bauen, ersetzen,
 * zerlegen. Die erwarteten Bytes und Pruefsummen sind von Hand gerechnet
 * (XOR aller Body-Bytes, danach die Ersetzungen).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACK,
  ETX,
  FrameParser,
  MSG,
  NAK,
  STX,
  buildPresetRecall,
  buildSvMessage,
  encodeFrame,
  formatAddress,
  percentToRaw,
  svKey,
  svKeyWithoutNode,
  type SvAddress,
} from "./soundweb-protocol.js";

const hex = (s: string) => Buffer.from(s.replace(/\s+/g, ""), "hex");

const fader: SvAddress = { node: 0x0001, virtualDevice: 0x03, objectId: 0x000147, stateVariable: 0x0000 };

test("Beispiel-Rahmen: SETSVPERCENT 50 % an Node 1, VD 3, Objekt 0x000147, SV 0", () => {
  // Body 8D 0001 03 000147 0000 00320000, Pruefsumme 8D^01^03^01^47^32 = FB.
  // Das VD-Byte 0x03 ist ETX und wird zu 1B 83.
  assert.deepEqual(
    buildSvMessage(MSG.SETSVPERCENT, fader, percentToRaw(50)),
    hex("02 8D 0001 1B83 000147 0000 00320000 FB 03"),
  );
});

test("Beispiel-Rahmen: SETSV mit negativem Rohwert", () => {
  // -1 als 32 Bit: FFFFFFFF. Pruefsumme 88^12^34^0A^AB^CD^EF^00^05^FF^FF^FF^FF = 28.
  const address: SvAddress = { node: 0x1234, virtualDevice: 0x0a, objectId: 0xabcdef, stateVariable: 0x0005 };
  assert.deepEqual(buildSvMessage(MSG.SETSV, address, -1), hex("02 88 1234 0A ABCDEF 0005 FFFFFFFF 28 03"));
});

test("Beispiel-Rahmen: Abruf eines Venue-Presets", () => {
  // Body 8B 00001002, Pruefsumme 8B^10^02 = 99; die 0x02 im Body wird zu 1B 82.
  assert.deepEqual(buildPresetRecall(MSG.VENUE_PRESET_RECALL, 0x1002), hex("02 8B 000010 1B82 99 03"));
});

test("Ersetzungen: alle fuenf Sonderzeichen im Body und in der Pruefsumme", () => {
  // Pruefsumme 02^03^06^15^1B = 09.
  assert.deepEqual(encodeFrame(hex("02 03 06 15 1B")), hex("02 1B82 1B83 1B86 1B95 1B9B 09 03"));
  // Pruefsumme 0x02 (80^82) wird ebenfalls ersetzt.
  assert.deepEqual(encodeFrame(hex("80 82")), hex("02 80 82 1B82 03"));
  // Ohne Sonderzeichen bleibt der Body, wie er ist.
  assert.deepEqual(encodeFrame(hex("10 20")), hex("02 10 20 30 03"));
});

test("Bauen: falscher Nachrichtentyp wird abgelehnt, Werte werden auf ihre Feldbreite gekuerzt", () => {
  assert.throws(() => buildSvMessage(MSG.VENUE_PRESET_RECALL, fader, 0), /Kein SV-Nachrichtentyp: 0x8b/);
  assert.throws(() => buildPresetRecall(MSG.SETSV, 1), /Kein Preset-Nachrichtentyp: 0x88/);
  const wide: SvAddress = { node: 0x10001, virtualDevice: 0x103, objectId: 0x1000147, stateVariable: 0x10000 };
  assert.deepEqual(buildSvMessage(MSG.SETSV, wide, 0), buildSvMessage(MSG.SETSV, fader, 0));
});

test("Prozent: 0 bis 100, gerundet auf 1/65536, ausserhalb begrenzt", () => {
  assert.equal(percentToRaw(0), 0);
  assert.equal(percentToRaw(100), 6_553_600);
  assert.equal(percentToRaw(12.5), 819_200);
  assert.equal(percentToRaw(-3), 0);
  assert.equal(percentToRaw(140), 6_553_600);
});

test("Zerlegen: gebaute Rahmen ergeben dieselbe Nachricht", () => {
  const parser = new FrameParser();
  const { messages, errors } = parser.push(
    Buffer.concat([buildSvMessage(MSG.SETSVPERCENT, fader, percentToRaw(50)), buildPresetRecall(MSG.PARAM_PRESET_RECALL, 0x1002)]),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(messages, [
    { type: MSG.SETSVPERCENT, address: fader, data: 0x00320000 },
    { type: MSG.PARAM_PRESET_RECALL, address: null, data: 0x1002 },
  ]);
});

test("Zerlegen: Rahmen in einzelnen Bytes, auch mitten in einer Ersetzung geteilt", () => {
  const frame = buildSvMessage(MSG.SETSV, fader, -2);
  const parser = new FrameParser();
  const messages = [];
  for (const byte of frame) {
    const out = parser.push(Buffer.from([byte]));
    assert.deepEqual(out.errors, []);
    messages.push(...out.messages);
  }
  assert.deepEqual(messages, [{ type: MSG.SETSV, address: fader, data: -2 }]);
  // Zwei Rahmen, an beliebiger Stelle geteilt: 1B | 83 liegt im ersten Teil.
  const two = Buffer.concat([frame, frame]);
  for (let cut = 1; cut < two.length; cut++) {
    const p = new FrameParser();
    const a = p.push(two.subarray(0, cut));
    const b = p.push(two.subarray(cut));
    assert.equal(a.messages.length + b.messages.length, 2, `Schnitt bei ${cut}`);
    assert.deepEqual([...a.errors, ...b.errors], [], `Schnitt bei ${cut}`);
  }
});

test("Zerlegen: ACK, NAK und Bytes zwischen Rahmen werden uebergangen", () => {
  const parser = new FrameParser();
  const frame = buildPresetRecall(MSG.VENUE_PRESET_RECALL, 7);
  const { messages, errors } = parser.push(Buffer.concat([Buffer.from([ACK, NAK, 0x41, ETX]), frame, Buffer.from([ACK])]));
  assert.deepEqual(errors, []);
  assert.deepEqual(messages, [{ type: MSG.VENUE_PRESET_RECALL, address: null, data: 7 }]);
});

test("Zerlegen: falsche Pruefsumme, abgebrochener Rahmen, falsche Laenge und unbekannter Typ stehen als Fehler da", () => {
  const parser = new FrameParser();
  // Pruefsumme 00 statt 99.
  assert.deepEqual(parser.push(hex("02 8B 000010 1B82 00 03")), {
    messages: [],
    errors: ["Prüfsumme falsch (8b00001002)"],
  });
  // Neues STX vor dem ETX: der alte Rahmen faellt weg, der neue zaehlt.
  const frame = buildPresetRecall(MSG.VENUE_PRESET_RECALL, 7);
  const cut = parser.push(Buffer.concat([hex("02 8B 00"), frame]));
  assert.deepEqual(cut.errors, ["Rahmen ohne ETX abgebrochen"]);
  assert.equal(cut.messages.length, 1);
  assert.deepEqual(parser.push(Buffer.from([STX, ETX])).errors, ["Leerer Rahmen"]);
  assert.deepEqual(parser.push(encodeFrame(hex("88 0001"))).errors, ["SV-Nachricht 0x88 mit 3 Bytes"]);
  assert.deepEqual(parser.push(encodeFrame(hex("8B 0001"))).errors, ["Preset-Nachricht mit 3 Bytes"]);
  assert.deepEqual(parser.push(encodeFrame(hex("42 0001"))).errors, ["Unbekannter Nachrichtentyp 0x42"]);
});

test("Zerlegen: ein Rahmen ohne Ende ueber 64 Bytes verliert die Synchronisation und faengt neu an", () => {
  const parser = new FrameParser();
  const long = parser.push(Buffer.concat([Buffer.from([STX]), Buffer.alloc(70, 0x41)]));
  assert.deepEqual(long, { messages: [], errors: ["Rahmen zu lang – Synchronisation verloren"] });
  const next = parser.push(buildPresetRecall(MSG.VENUE_PRESET_RECALL, 3));
  assert.deepEqual(next, { messages: [{ type: MSG.VENUE_PRESET_RECALL, address: null, data: 3 }], errors: [] });
});

test("Schluessel und Anzeige einer SV", () => {
  assert.equal(svKey(fader), "1:3:327:0");
  assert.equal(svKeyWithoutNode(fader), "*:3:327:0");
  assert.equal(formatAddress(fader), "0x000103000147 SV 0");
});
