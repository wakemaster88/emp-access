import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasEditedMaskInExtraConfig,
  isEditedMask,
  isMaskedSecret,
  keepStoredIfMasked,
  maskApiConfig,
  maskExtraConfig,
  maskSecret,
  restoreMaskedExtraConfig,
  typedOverMask,
} from "./secret-mask";

test("Maske: letzte 4 Zeichen, kurze Werte ganz verdeckt", () => {
  assert.equal(maskSecret("abcdefgh1234"), "••••1234");
  assert.equal(maskSecret("abcdefgh"), "••••efgh");
  assert.equal(maskSecret("abc1234"), "••••");
  assert.equal(maskSecret(""), "");
  assert.equal(maskSecret(null), "");
});

test("Maske beim Speichern heißt unverändert", () => {
  assert.equal(isMaskedSecret("••••1234"), true);
  assert.equal(isMaskedSecret("••••"), true);
  assert.equal(isMaskedSecret("neuer-token"), false);
  assert.equal(isMaskedSecret(""), false);
  assert.equal(isMaskedSecret(undefined), false);
  assert.equal(keepStoredIfMasked("••••1234", "gespeichert-1234"), "gespeichert-1234");
  assert.equal(keepStoredIfMasked("neu", "gespeichert-1234"), "neu");
  assert.equal(keepStoredIfMasked("", "gespeichert-1234"), "");
  assert.equal(keepStoredIfMasked("••••", null), "");
});

test("extraConfig: nur geheime Angaben maskiert, Rest bleibt", () => {
  const raw = JSON.stringify({ webhookSecret: "0123456789abcdef", notificationId: 42, monitorUrl: "https://example.invalid/m?token=xyzw9876" });
  const masked = JSON.parse(maskExtraConfig(raw)!);
  assert.deepEqual(masked, { webhookSecret: "••••cdef", notificationId: 42, monitorUrl: "••••9876" });
  assert.equal(maskExtraConfig('{"interfaceIds":[2,3]}'), '{"interfaceIds":[2,3]}');
  assert.equal(maskExtraConfig("kein json"), "kein json");
  assert.equal(maskExtraConfig(null), null);
});

test("extraConfig: maskierte Angaben kommen aus dem gespeicherten Satz zurück", () => {
  const stored = JSON.stringify({ webhookSecret: "0123456789abcdef", monitorUrl: "https://example.invalid/m?token=xyzw9876" });
  const posted = JSON.stringify({ webhookSecret: "••••cdef", monitorUrl: "••••9876", key: "neu" });
  assert.deepEqual(JSON.parse(restoreMaskedExtraConfig(posted, stored)!), {
    webhookSecret: "0123456789abcdef",
    monitorUrl: "https://example.invalid/m?token=xyzw9876",
    key: "neu",
  });
  // Neu eingetragener Link bleibt, leerer Link bleibt leer (= entfernen wie bisher)
  assert.deepEqual(JSON.parse(restoreMaskedExtraConfig(JSON.stringify({ monitorUrl: "" }), stored)!), { monitorUrl: "" });
  // Maske ohne gespeicherten Wert: Angabe fällt weg (die Route erzeugt dann ein neues Geheimnis)
  assert.deepEqual(JSON.parse(restoreMaskedExtraConfig(JSON.stringify({ webhookSecret: "••••" }), null)!), {});
  assert.equal(restoreMaskedExtraConfig('{"a":1}', stored), '{"a":1}');
  assert.equal(restoreMaskedExtraConfig(null, stored), null);
});

test("extraConfig: Nuki-Webhook-Adresse mit Secret ist maskiert und kommt beim Speichern zurück", () => {
  const url = "https://example.invalid/api/integrations/nuki/webhook?secret=0123456789abcdef";
  const stored = JSON.stringify({ webhookSecret: "0123456789abcdef", notificationId: 7, webhookUrl: url });
  const masked = JSON.parse(maskExtraConfig(stored)!);
  assert.deepEqual(masked, { webhookSecret: "••••cdef", notificationId: 7, webhookUrl: "••••cdef" });
  assert.ok(!JSON.stringify(maskApiConfig({ token: "t", extraConfig: stored })).includes("0123456789abcdef"));
  assert.deepEqual(JSON.parse(restoreMaskedExtraConfig(JSON.stringify(masked), stored)!), {
    webhookSecret: "0123456789abcdef",
    notificationId: 7,
    webhookUrl: url,
  });
});

test("maskApiConfig setzt Kennzeichen und verdeckt Token", () => {
  const c = maskApiConfig({ id: 1, token: "token-abcdefgh", extraConfig: JSON.stringify({ webhookSecret: "s3cr3t-value-1" }) });
  assert.equal(c.token, "••••efgh");
  assert.equal(c.tokenStored, true);
  assert.deepEqual(c.secretsStored, { webhookSecret: true, monitorUrl: false, webhookUrl: false });
  assert.equal(JSON.parse(c.extraConfig!).webhookSecret, "••••ue-1");
  const empty = maskApiConfig({ token: "", extraConfig: null });
  assert.equal(empty.token, "");
  assert.equal(empty.tokenStored, false);
});

test("Weitertippen hinter der Maske ergibt nur den neuen Wert", () => {
  assert.equal(typedOverMask("••••1234", "••••1234x"), "x");
  assert.equal(typedOverMask("••••1234", "neu"), "neu");
  assert.equal(typedOverMask("alt", "alt2"), "alt2");
});

test("In die Maske getippt wird erkannt, die unveränderte Maske nicht", () => {
  const stored = "gespeichert-1234";
  assert.equal(isEditedMask("••••1234", stored), false);
  assert.equal(isEditedMask("••••", stored), false);
  assert.equal(isEditedMask("••••", "kurz"), false);
  assert.equal(isEditedMask("neuer-token", stored), false);
  assert.equal(isEditedMask("", stored), false);
  assert.equal(isEditedMask(undefined, stored), false);
  // davor, dahinter, mittendrin getippt
  assert.equal(isEditedMask("Z••••1234", stored), true);
  assert.equal(isEditedMask("NEU••••", "kurz"), true);
  assert.equal(isEditedMask("••••1234NEU", stored), true);
  assert.equal(isEditedMask("••••12X34", stored), true);
  // Maske eines anderen Werts (z. B. inzwischen anderswo geändert)
  assert.equal(isEditedMask("••••9999", stored), true);
});

test("extraConfig: in die Maske eines Geheimnisses getippt wird erkannt", () => {
  const stored = JSON.stringify({ webhookSecret: "0123456789abcdef", monitorUrl: "https://example.invalid/m/xyzw9876" });
  const masked = maskExtraConfig(stored)!;
  assert.equal(hasEditedMaskInExtraConfig(masked, stored), false);
  assert.equal(hasEditedMaskInExtraConfig(JSON.stringify({ webhookSecret: "neu-und-lang-genug" }), stored), false);
  assert.equal(hasEditedMaskInExtraConfig(JSON.stringify({ ...JSON.parse(masked), monitorUrl: "x••••9876" }), stored), true);
  assert.equal(hasEditedMaskInExtraConfig(JSON.stringify({ webhookSecret: "••••cdefNEU" }), stored), true);
  assert.equal(hasEditedMaskInExtraConfig("kein json", stored), false);
  assert.equal(hasEditedMaskInExtraConfig(null, stored), false);
});

test("GARDENA: extraConfig als Rohtext (Application Secret) wird ganz maskiert", () => {
  const secret = "00000000-1111-2222-3333-444455556666";
  const c = maskApiConfig({ provider: "GARDENA", token: "application-key-abcd", extraConfig: secret });
  assert.ok(!JSON.stringify(c).includes(secret));
  assert.equal(c.extraConfig, "••••6666");
  assert.equal(c.token, "••••abcd");
  assert.equal(c.secretsStored.extraConfig, true);
  assert.equal(maskApiConfig({ provider: "GARDENA", token: "", extraConfig: null }).extraConfig, null);
  // Andere Anbieter: Rohtext bleibt wie bisher
  assert.equal(maskApiConfig({ provider: "WAKESYS", token: "", extraConfig: "kein json" }).extraConfig, "kein json");
});
