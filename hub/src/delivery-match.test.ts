import { test } from "node:test";
import assert from "node:assert/strict";
import { inDeliveryWindow, matchDeliveryBrand } from "./delivery-match.js";

test("Marken an der Aufschrift erkennen", () => {
  assert.equal(matchDeliveryBrand(["DHL", "RE-AB 123"]), "DHL");
  assert.equal(matchDeliveryBrand(["Deutsche Post"]), "DHL");
  assert.equal(matchDeliveryBrand(["ups"]), "UPS");
  assert.equal(matchDeliveryBrand(["amazon prime"]), "AMAZON");
  assert.equal(matchDeliveryBrand(["GLS Germany"]), "GLS");
  assert.equal(matchDeliveryBrand(["Hermes"]), "HERMES");
});

test("Marke nur als eigenes Wort", () => {
  assert.equal(matchDeliveryBrand(["GROUPS", "SUPS"]), null);
  assert.equal(matchDeliveryBrand(["DHLX"]), null);
  assert.equal(matchDeliveryBrand([]), null);
});

test("Zeitfenster und Wochentage", () => {
  const mo = (h: number, m = 0) => new Date(2026, 10, 2, h, m); // Montag
  const days = [1, 2, 3, 4, 5, 6];
  assert.equal(inDeliveryWindow(null, null, mo(6, 59), days), false);
  assert.equal(inDeliveryWindow(null, null, mo(7, 0), days), true);
  assert.equal(inDeliveryWindow(null, null, mo(19, 59), days), true);
  assert.equal(inDeliveryWindow(null, null, mo(20, 0), days), false);
  assert.equal(inDeliveryWindow("08:30", "12:00", mo(8, 15), days), false);
  assert.equal(inDeliveryWindow("08:30", "12:00", mo(9), days), true);
  const so = new Date(2026, 10, 8, 10, 0); // Sonntag
  assert.equal(inDeliveryWindow(null, null, so, days), false);
  assert.equal(inDeliveryWindow("22:00", "02:00", mo(23), days), true);
});
