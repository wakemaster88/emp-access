import assert from "node:assert/strict";
import { test } from "node:test";
import { pickBeachSchedule, pickLiftSchedule, pickShopSchedule } from "./operating-role";

const live = [
  { id: 3, name: "Strandbad", isDefault: false, role: null },
  { id: 5, name: "Wasserski", isDefault: false, role: null },
  { id: 7, name: "Shop", isDefault: false, role: null },
];

test("ohne Verwendung entscheidet weiter der Name", () => {
  assert.equal(pickLiftSchedule(live)?.id, 5);
  assert.equal(pickShopSchedule(live)?.id, 7);
  assert.equal(pickBeachSchedule(live)?.id, 3);
});

test("Verwendung geht vor dem Namen", () => {
  const renamed = [
    { id: 5, name: "Cable Park", isDefault: false, role: "LIFT" },
    { id: 7, name: "Kasse", isDefault: false, role: "SHOP" },
    { id: 3, name: "Badestelle", isDefault: false, role: "BEACH" },
    { id: 9, name: "Lift alt", isDefault: true, role: null },
  ];
  assert.equal(pickLiftSchedule(renamed)?.id, 5);
  assert.equal(pickShopSchedule(renamed)?.id, 7);
  assert.equal(pickBeachSchedule(renamed)?.id, 3);
});

test("Shop fällt auf den Lift zurück, Strandbad nie auf die Vorbelegung", () => {
  const onlyLift = [
    { id: 5, name: "Cable Park", isDefault: false, role: "LIFT" },
    { id: 4, name: "Gastronomie", isDefault: true, role: null },
  ];
  assert.equal(pickShopSchedule(onlyLift)?.id, 5);
  assert.equal(pickBeachSchedule(onlyLift), null);
  assert.equal(pickLiftSchedule([{ id: 4, name: "Gastronomie", isDefault: true }])?.id, 4);
});
