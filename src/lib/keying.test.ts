import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildKeyNumberSeries,
  createSignatureToken,
  deriveHandoverStatus,
  findUnavailableKeys,
  holderDisplayName,
  isOverdue,
  isPlausibleSignatureToken,
  keyStatusAfterReturn,
  signatureState,
} from "./keying";

test("Kopf-Status folgt den Positionen", () => {
  assert.equal(deriveHandoverStatus([]), "DRAFT");
  assert.equal(deriveHandoverStatus([{ itemStatus: "ISSUED" }, { itemStatus: "ISSUED" }]), "ISSUED");
  assert.equal(
    deriveHandoverStatus([{ itemStatus: "ISSUED" }, { itemStatus: "RETURNED" }]),
    "PARTIALLY_RETURNED",
  );
  assert.equal(
    deriveHandoverStatus([{ itemStatus: "RETURNED" }, { itemStatus: "RETURNED" }]),
    "RETURNED",
  );
});

test("Nur Verluste ergeben ein Verlust-Protokoll, gemischt zaehlt als zurueck", () => {
  assert.equal(deriveHandoverStatus([{ itemStatus: "LOST" }, { itemStatus: "LOST" }]), "LOST");
  assert.equal(
    deriveHandoverStatus([{ itemStatus: "LOST" }, { itemStatus: "RETURNED" }]),
    "RETURNED",
  );
  // Ein offener Schluessel schlaegt jeden Verlust: der Vorgang laeuft weiter.
  assert.equal(
    deriveHandoverStatus([{ itemStatus: "LOST" }, { itemStatus: "ISSUED" }]),
    "PARTIALLY_RETURNED",
  );
});

test("Doppelausgabe wird erkannt", () => {
  const keys = [
    { id: 1, keyNumber: "A-1", status: "AVAILABLE" },
    { id: 2, keyNumber: "A-2", status: "ISSUED" },
    { id: 3, keyNumber: "A-3", status: "LOST" },
    { id: 4, keyNumber: "A-4", status: "DESTROYED" },
  ];
  assert.deepEqual(
    findUnavailableKeys(keys).map((k) => k.keyNumber),
    ["A-2", "A-3", "A-4"],
  );
  assert.deepEqual(findUnavailableKeys([keys[0]!]), []);
});

test("Rueckgabe setzt den Schluesselstatus passend", () => {
  assert.equal(keyStatusAfterReturn("RETURNED"), "AVAILABLE");
  assert.equal(keyStatusAfterReturn("LOST"), "LOST");
  assert.equal(keyStatusAfterReturn("ISSUED"), "ISSUED");
});

test("Nummernserie mit Standardformat", () => {
  assert.deepEqual(buildKeyNumberSeries({ prefix: "Z12", count: 3 }), ["Z12-1", "Z12-2", "Z12-3"]);
});

test("Nummernserie mit Startwert, Trennzeichen und Nullen", () => {
  assert.deepEqual(
    buildKeyNumberSeries({ prefix: "GHS", count: 3, startIndex: 8, separator: "/", padding: 3 }),
    ["GHS/008", "GHS/009", "GHS/010"],
  );
  assert.deepEqual(buildKeyNumberSeries({ prefix: "K", count: 1, separator: "" }), ["K1"]);
});

test("Token ist lang genug und eindeutig", () => {
  const a = createSignatureToken();
  const b = createSignatureToken();
  assert.notEqual(a, b);
  assert.ok(isPlausibleSignatureToken(a));
  assert.ok(/^[A-Za-z0-9_-]+$/.test(a), "base64url ohne Sonderzeichen");
});

test("Zu kurze oder fehlende Tokens werden abgewiesen", () => {
  assert.equal(isPlausibleSignatureToken(""), false);
  assert.equal(isPlausibleSignatureToken("kurz"), false);
  assert.equal(isPlausibleSignatureToken(null), false);
  assert.equal(isPlausibleSignatureToken("x".repeat(200)), false);
});

test("Signatur-Zustand: offen, abgelaufen, signiert", () => {
  const now = new Date("2026-09-01T10:00:00.000Z");
  assert.equal(
    signatureState({ signedAt: null, expiresAt: new Date("2026-09-10T00:00:00.000Z") }, now),
    "OPEN",
  );
  assert.equal(
    signatureState({ signedAt: null, expiresAt: new Date("2026-08-30T00:00:00.000Z") }, now),
    "EXPIRED",
  );
  // Unterschrieben bleibt unterschrieben, auch wenn die Frist vorbei ist.
  assert.equal(
    signatureState(
      { signedAt: new Date("2026-08-29T00:00:00.000Z"), expiresAt: new Date("2026-08-30T00:00:00.000Z") },
      now,
    ),
    "SIGNED",
  );
});

test("Ueberfaellig nur bei offenem Vorgang mit Frist", () => {
  const now = new Date("2026-09-01T10:00:00.000Z");
  const past = new Date("2026-08-20T00:00:00.000Z");
  assert.equal(isOverdue({ dueAt: past, status: "ISSUED" }, now), true);
  assert.equal(isOverdue({ dueAt: past, status: "PARTIALLY_RETURNED" }, now), true);
  assert.equal(isOverdue({ dueAt: past, status: "RETURNED" }, now), false);
  assert.equal(isOverdue({ dueAt: past, status: "LOST" }, now), false);
  assert.equal(isOverdue({ dueAt: null, status: "ISSUED" }, now), false);
  assert.equal(
    isOverdue({ dueAt: new Date("2026-09-30T00:00:00.000Z"), status: "ISSUED" }, now),
    false,
  );
});

test("Anzeigename kombiniert Person und Firma", () => {
  assert.equal(holderDisplayName({ firstName: "Lena", lastName: "Vogt" }), "Lena Vogt");
  assert.equal(
    holderDisplayName({ firstName: "Lena", lastName: "Vogt", company: "Elektro Meier" }),
    "Lena Vogt (Elektro Meier)",
  );
  assert.equal(holderDisplayName({ company: "Elektro Meier" }), "Elektro Meier");
  assert.equal(holderDisplayName({ firstName: "  ", lastName: null }), "Unbekannt");
});
