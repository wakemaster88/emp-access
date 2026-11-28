import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOfferDiscount } from "./shop-scan";
import { centsText, empShopQuoteBody, isShopQuoteEmail, parseShopQuoteRequest, SHOP_QUOTE_MAX_ITEMS } from "./shop-quote";
import { issueShopQuoteTicket, SHOP_QUOTE_TICKET_MINUTES, shopQuoteTicketQuoteId } from "./shop-quote-ticket";
import { createEmpShopQuote, EMP_SHOP_QUOTES_SCOPE_MESSAGE, fetchEmpShopQuotePdf } from "./emp-shop-client";

// secret-box leitet den Schluessel erst beim ersten Gebrauch ab.
process.env.AUTH_SECRET ||= "test-secret-nur-fuer-tests";

const NOW = new Date("2026-11-28T14:00:00Z");

/** Drei 2024 Ronix One zu 529 € und drei Fatboy Lamzac zu 49,90 €, 10 % Rabatt: 1.563,03 € (wie im EMP-Shop). */
const angebot = {
  requestKey: "0f8e3c1a-6b2d-4e7f-9a10-5c3b2d1e0f9a",
  items: [
    { variantId: "var_ronix_one_142", quantity: 2 },
    { variantId: "var_lamzac_black", quantity: 3 },
    { variantId: "var_ronix_one_142", quantity: 1 },
  ],
  discount: { kind: "percent", basisPoints: 1000 },
  customer: { name: "  Max   Mustermann ", email: " Max@Example.DE " },
  expectedTotalCents: 156303,
};

test("centsText: Cent als Text mit Punkt, nie als Gleitkommazahl", () => {
  assert.equal(centsText(156303), "1563.03");
  assert.equal(centsText(4990), "49.90");
  assert.equal(centsText(5), "0.05");
  assert.equal(centsText(0), "0.00");
  assert.equal(centsText(-1250), "-12.50");
  // Basispunkte ergeben Prozent
  assert.equal(centsText(1000), "10.00");
  assert.equal(centsText(1250), "12.50");
});

test("Monitor und Shop rechnen dieselbe Summe: 3 × 529 € + 3 × 49,90 € minus 10 %", () => {
  const total = 3 * 52900 + 3 * 4990;
  assert.equal(total, 173670);
  assert.equal(applyOfferDiscount(total, { kind: "percent", basisPoints: 1000 }).finalCents, 156303);
});

test("parseShopQuoteRequest: gleiche Variante wird eine Position, Name und E-Mail bereinigt", () => {
  const r = parseShopQuoteRequest(angebot);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value.items, [
    { variantId: "var_ronix_one_142", quantity: 3 },
    { variantId: "var_lamzac_black", quantity: 3 },
  ]);
  assert.deepEqual(r.value.discount, { kind: "percent", basisPoints: 1000 });
  assert.deepEqual(r.value.customer, { name: "Max Mustermann", email: "max@example.de" });
  assert.equal(r.value.expectedTotalCents, 156303);
});

test("parseShopQuoteRequest: Laufkunde ohne Angaben und ohne Rabatt", () => {
  const r = parseShopQuoteRequest({ ...angebot, discount: null, customer: { name: "  ", email: "" }, expectedTotalCents: 173670 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.discount, null);
  assert.deepEqual(r.value.customer, { name: null, email: null });
  const ohneKunde = parseShopQuoteRequest({ ...angebot, discount: undefined, customer: undefined });
  assert.equal(ohneKunde.ok && ohneKunde.value.customer.name, null);
});

test("parseShopQuoteRequest: lehnt Ungültiges ab", () => {
  const fehler = (body: unknown) => {
    const r = parseShopQuoteRequest(body);
    assert.equal(r.ok, false);
    return r.ok ? "" : r.error;
  };
  assert.match(fehler(null), /Ungültige Anfrage/);
  assert.match(fehler({ ...angebot, requestKey: "kurz" }), /neu laden/);
  assert.match(fehler({ ...angebot, items: [] }), /keine Positionen/);
  assert.match(fehler({ ...angebot, items: Array.from({ length: SHOP_QUOTE_MAX_ITEMS + 1 }, (_, i) => ({ variantId: `v${i}`, quantity: 1 })) }), /Höchstens 100/);
  assert.match(fehler({ ...angebot, items: [{ variantId: "var/../x", quantity: 1 }] }), /Ungültige Positionen/);
  assert.match(fehler({ ...angebot, items: [{ variantId: "v1", quantity: 0 }] }), /Ungültige Menge/);
  assert.match(fehler({ ...angebot, items: [{ variantId: "v1", quantity: 1.5 }] }), /Ungültige Menge/);
  assert.match(fehler({ ...angebot, discount: { kind: "percent", basisPoints: 20_000 } }), /Ungültiger Rabatt/);
  assert.match(fehler({ ...angebot, customer: { email: "kein-at.de" } }), /E-Mail-Adresse/);
  assert.match(fehler({ ...angebot, expectedTotalCents: 1563.03 }), /Ungültige Summe/);
  assert.match(fehler({ ...angebot, expectedTotalCents: -1 }), /Ungültige Summe/);
});

test("isShopQuoteEmail", () => {
  assert.equal(isShopQuoteEmail("lena.brandt@example.de"), true);
  assert.equal(isShopQuoteEmail("lena@example"), false);
  assert.equal(isShopQuoteEmail("lena brandt@example.de"), false);
  assert.equal(isShopQuoteEmail(`${"a".repeat(195)}@ex.de`), false);
});

test("empShopQuoteBody: Rabatt als Prozent, Betrag oder Endpreis, Beträge als Text", () => {
  const r = parseShopQuoteRequest(angebot);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(empShopQuoteBody(r.value, "Shop-Monitor Kasse (EMP-Access)"), {
    items: [
      { variantId: "var_ronix_one_142", quantity: 3 },
      { variantId: "var_lamzac_black", quantity: 3 },
    ],
    discount: { percent: "10.00" },
    customer: { name: "Max Mustermann", email: "max@example.de" },
    expectedGrossTotal: "1563.03",
    print: true,
    source: "Shop-Monitor Kasse (EMP-Access)",
  });
  const betrag = empShopQuoteBody({ ...r.value, discount: { kind: "amount", cents: 5000 }, expectedTotalCents: 168670 }, "x");
  assert.deepEqual(betrag.discount, { amount: "50.00" });
  assert.equal(betrag.expectedGrossTotal, "1686.70");
  const endpreis = empShopQuoteBody({ ...r.value, discount: { kind: "total", cents: 110000 }, expectedTotalCents: 110000 }, "x");
  assert.deepEqual(endpreis.discount, { total: "1100.00" });
  const ohne = empShopQuoteBody({ ...r.value, discount: null }, "y".repeat(200));
  assert.equal("discount" in ohne, false);
  assert.equal((ohne.source as string).length, 80);
});

test("Angebots-Beleg: nur für denselben Mandanten und Monitor, läuft ab", () => {
  const ticket = issueShopQuoteTicket(7, 42, "cmquote123", NOW);
  assert.equal(shopQuoteTicketQuoteId(ticket, 7, 42, NOW), "cmquote123");
  assert.equal(shopQuoteTicketQuoteId(ticket, 8, 42, NOW), null);
  assert.equal(shopQuoteTicketQuoteId(ticket, 7, 43, NOW), null);
  const spaeter = new Date(NOW.getTime() + SHOP_QUOTE_TICKET_MINUTES * 60_000);
  assert.equal(shopQuoteTicketQuoteId(ticket, 7, 42, spaeter), null);
  assert.equal(shopQuoteTicketQuoteId("kaputt", 7, 42, NOW), null);
  assert.equal(shopQuoteTicketQuoteId(undefined, 7, 42, NOW), null);
  // Eine Kennung mit fremden Zeichen kommt nie in die URL zum Shop
  assert.equal(shopQuoteTicketQuoteId(issueShopQuoteTicket(7, 42, "../admin", NOW), 7, 42, NOW), null);
});

const angelegt = {
  id: "cmquote123",
  number: "AN-2026-00017",
  status: "SENT",
  validUntil: "2026-12-28",
  currency: "EUR",
  total: "1736.70",
  discount: "173.67",
  grossTotal: "1563.03",
  customer: { number: "K-10001", name: "Laufkunde", matched: false },
  print: { route: "BROWSER", printerName: null, message: null },
  pdfPath: "/api/v1/quotes/cmquote123/pdf",
};

test("createEmpShopQuote: Schlüssel, Idempotency-Key und Antworten des Shops", async () => {
  const calls: Array<{ url: string; method?: string; auth: string | null; key: string | null; body: unknown }> = [];
  const ok: typeof fetch = async (input, init) => {
    const h = new Headers(init?.headers);
    calls.push({ url: String(input), method: init?.method, auth: h.get("authorization"), key: h.get("idempotency-key"), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(angelegt), { status: 201, headers: { "content-type": "application/json" } });
  };
  const config = { token: "emp_test_geheim", baseUrl: null };
  const r = await createEmpShopQuote(config, { items: [] }, "emp-access-42-abc", ok);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.quote.number, "AN-2026-00017");
  assert.equal(calls[0]!.url, "https://emp-shop-backoffice.vercel.app/api/v1/quotes");
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.auth, "Bearer emp_test_geheim");
  assert.equal(calls[0]!.key, "emp-access-42-abc");

  const antwort = (status: number, body: unknown): typeof fetch => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/problem+json" } });
  // Summe weicht ab: nichts angelegt, die Summe des Shops kommt mit
  assert.deepEqual(await createEmpShopQuote(config, {}, "k", antwort(409, { title: "Summe weicht ab", grossTotal: "1563.04" })), {
    ok: false,
    status: 409,
    message: "Im Shop ergibt das Angebot eine andere Summe. Es wurde nichts angelegt.",
    grossTotalCents: 156304,
  });
  assert.deepEqual(await createEmpShopQuote(config, {}, "k", antwort(403, {})), { ok: false, status: 409, message: EMP_SHOP_QUOTES_SCOPE_MESSAGE });
  assert.match(EMP_SHOP_QUOTES_SCOPE_MESSAGE, /Angebote anlegen und drucken/);
  const abgelehnt = await createEmpShopQuote(config, {}, "k", antwort(422, { detail: "B-Ware bitte im Backoffice anbieten." }));
  assert.equal(abgelehnt.ok, false);
  assert.equal(!abgelehnt.ok && abgelehnt.message, "B-Ware bitte im Backoffice anbieten.");
  const alt = await createEmpShopQuote(config, {}, "k", antwort(404, {}));
  assert.match(!alt.ok ? alt.message : "", /ältere Version/);
  const komisch = await createEmpShopQuote(config, {}, "k", antwort(201, { id: 1 }));
  assert.equal(komisch.ok, false);
  const weg = await createEmpShopQuote(config, {}, "k", async () => { throw new Error("offline"); });
  assert.match(!weg.ok ? weg.message : "", /kein zweites Angebot/);
  const falscheAdresse = await createEmpShopQuote({ token: "x", baseUrl: "ftp://shop" }, {}, "k", async () => { throw new Error("nicht aufrufen"); });
  assert.equal(falscheAdresse.ok, false);
});

test("fetchEmpShopQuotePdf: nur ein PDF wird weitergegeben", async () => {
  const config = { token: "emp_test_geheim", baseUrl: null };
  let url = "";
  const pdf: typeof fetch = async (input) => {
    url = String(input);
    return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="AN-2026-00017.pdf"' } });
  };
  const r = await fetchEmpShopQuotePdf(config, "cmquote123", pdf);
  assert.equal(url, "https://emp-shop-backoffice.vercel.app/api/v1/quotes/cmquote123/pdf");
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.fileName, "AN-2026-00017.pdf");
  assert.equal(r.ok && r.pdf.byteLength, 4);
  const html: typeof fetch = async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
  assert.equal((await fetchEmpShopQuotePdf(config, "cmquote123", html)).ok, false);
  const ohneRecht: typeof fetch = async () => new Response("{}", { status: 403 });
  assert.deepEqual(await fetchEmpShopQuotePdf(config, "cmquote123", ohneRecht), { ok: false, status: 409, message: EMP_SHOP_QUOTES_SCOPE_MESSAGE });
});
