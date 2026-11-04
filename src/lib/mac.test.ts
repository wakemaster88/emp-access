import { test } from "node:test";
import assert from "node:assert/strict";
import { macSpellings, normalizeMac, sameDeviceMac } from "./mac";

test("normalizeMac vereinheitlicht Schreibweisen", () => {
  assert.equal(normalizeMac("74:7a:90:bd:09:4e"), "74:7A:90:BD:09:4E");
  assert.equal(normalizeMac("44-37-0B-FC-6A-3A"), "44:37:0B:FC:6A:3A");
  assert.equal(normalizeMac(" a8032abe54dc "), "A8:03:2A:BE:54:DC");
  assert.equal(normalizeMac("1C:CA:E3:75:86:E0"), "1C:CA:E3:75:86:E0");
});

test("normalizeMac lehnt Unsinn ab", () => {
  assert.equal(normalizeMac(""), null);
  assert.equal(normalizeMac(null), null);
  assert.equal(normalizeMac("192.168.1.1"), null);
  assert.equal(normalizeMac("1C:CA:E3:75:86"), null);
  assert.equal(normalizeMac("ZZ:CA:E3:75:86:E0"), null);
});

test("macSpellings deckt Altbestaende in anderer Schreibweise ab", () => {
  const list = macSpellings(["74:7A:90:BD:09:4E", "kaputt"]);
  assert.deepEqual(new Set(list), new Set([
    "74:7A:90:BD:09:4E",
    "74:7a:90:bd:09:4e",
    "74-7A-90-BD-09-4E",
    "74-7a-90-bd-09-4e",
  ]));
});

test("sameDeviceMac erkennt Switch-Basis-MAC und Management-MAC", () => {
  assert.equal(sameDeviceMac("10:DA:43:D9:A4:59", "10-da-43-d9-a4-5c"), true);
  assert.equal(sameDeviceMac("8C:3B:AD:66:C2:88", "12:22:33:44:55:66"), false);
  assert.equal(sameDeviceMac(null, "8C:3B:AD:66:C2:88"), false);
});
