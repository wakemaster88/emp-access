import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addToOffer,
  centsFromAmount,
  formatEuro,
  isShopLabelScan,
  offerTotals,
  parseStoredOffer,
  setOfferQuantity,
  shopLabelCode,
  shopScanCode,
  type ShopArticle,
} from "./shop-scan";
import { articlesFromLookup, empShopBaseUrl, lookupEmpShopArticles } from "./emp-shop-client";

/** 2024 Ronix One 142 cm wie auf dem Preisetikett im Laden: 529 €, UVP 659,99 €. */
const utopia: ShopArticle = {
  variantId: "var_ronix_one_142",
  sku: "242022",
  productNumber: "A-001711",
  name: "2024 Ronix One – Legacy Core – Glossy Black / Matte White",
  brand: "Ronix",
  options: ["142 cm"],
  conditionBadge: null,
  conditionNote: null,
  priceCents: 52900,
  priceDisplay: "529 €",
  msrpDisplay: "659,99 €",
  saving: "Du sparst 19 %",
  imageUrl: null,
  online: true,
};

/** Fatboy Lamzac 2.0 Luftsofa Black: 49,90 €, UVP 74,50 €. */
const lamzac: ShopArticle = { ...utopia, variantId: "var_lamzac_black", sku: "DIV08", productNumber: "A-000742", name: "Fatboy Lamzac 2.0 Luftsofa", brand: "Fatboy", options: ["Black"], priceCents: 4990, priceDisplay: "49,90 €", msrpDisplay: "74,50 €", saving: "Du sparst 33 %" };

test("shopLabelCode: liest die Artikelnummer aus dem Etikett-Link", () => {
  assert.equal(shopLabelCode("HTTPS://4WAKE.EU/A/RNX-KIN26-139"), "RNX-KIN26-139");
  assert.equal(shopLabelCode("https://www.4wake.eu/a/242022/"), "242022");
  // Artikelnummer mit Schrägstrich (Größe S/M) bleibt ganz
  assert.equal(shopLabelCode("HTTPS://4WAKE.EU/A/35018.240400-SD-S/M"), "35018.240400-SD-S/M");
  assert.equal(shopLabelCode("HTTPS://4WAKE.EU/A/A%C3%84"), "AÄ");
});

test("shopLabelCode: versteht einen US-Scanner an deutscher Tastatur", () => {
  // „:“ kommt als „Ö“, „/“ als „-“, „-“ als „ß“, Y und Z vertauscht
  assert.equal(shopLabelCode("HTTPSÖ--4WAKE.EU-A-RNXßKIN26ß139"), "RNX-KIN26-139");
  assert.equal(shopLabelCode("HTTPSÖ--4WAKE.EU-A-35018.240400ßSDßS-M"), "35018.240400-SD-S/M");
  assert.equal(shopLabelCode("HTTPSÖ--4WAKE.EU-A-LAMYACß2.0ßGREZ"), "LAMZAC-2.0-GREY");
});

test("shopLabelCode: Tickets, Bändchen und EAN sind kein Etikett", () => {
  assert.equal(shopLabelCode("TK-4711-0815"), null);
  assert.equal(shopLabelCode("0888392260109"), null);
  assert.equal(shopLabelCode("https://emp-access.vercel.app/app/abc"), null);
  assert.equal(shopLabelCode("HTTPS://4WAKE.EU/A/"), null);
  assert.equal(isShopLabelScan("HTTPS://4WAKE.EU/A/242022"), true);
  assert.equal(isShopLabelScan("04A2B3C4D5"), false);
});

test("shopScanCode: Etikett wird zur Artikelnummer, sonst bleibt der Scan", () => {
  assert.equal(shopScanCode(" HTTPS://4WAKE.EU/A/242022 "), "242022");
  // Oakley Holbrook, EAN von der Verpackung
  assert.equal(shopScanCode(" 0888392260109\n"), "0888392260109");
});

test("centsFromAmount und formatEuro rechnen ohne Gleitkomma", () => {
  assert.equal(centsFromAmount("529.95"), 52995);
  assert.equal(centsFromAmount("49.9"), 4990);
  assert.equal(centsFromAmount("1499"), 149900);
  assert.equal(centsFromAmount("0.10"), 10);
  assert.equal(centsFromAmount("abc"), null);
  assert.equal(centsFromAmount(null), null);
  assert.equal(formatEuro(149900).replace(/\s/g, " "), "1.499,00 €");
  assert.equal(formatEuro(4990).replace(/\s/g, " "), "49,90 €");
});

test("addToOffer: neuer Artikel oben, derselbe noch einmal zählt hoch", () => {
  let lines = addToOffer([], utopia);
  lines = addToOffer(lines, lamzac);
  assert.deepEqual(lines.map((l) => [l.article.sku, l.quantity]), [["DIV08", 1], ["242022", 1]]);
  lines = addToOffer(lines, utopia);
  lines = addToOffer(lines, utopia);
  assert.deepEqual(lines.map((l) => [l.article.sku, l.quantity]), [["DIV08", 1], ["242022", 3]]);
  // Höchstens 99 je Position, auch wenn der Scanner hängt
  assert.equal(addToOffer(setOfferQuantity(lines, "var_lamzac_black", 99), lamzac)[0]!.quantity, 99);
});

test("setOfferQuantity: setzt die Menge, 0 entfernt die Position", () => {
  const lines = addToOffer(addToOffer([], utopia), lamzac);
  assert.deepEqual(setOfferQuantity(lines, "var_ronix_one_142", 2).map((l) => l.quantity), [1, 2]);
  assert.deepEqual(setOfferQuantity(lines, "var_ronix_one_142", 0).map((l) => l.article.sku), ["DIV08"]);
});

test("offerTotals: Summe der Positionen, ohne Preis bleibt offen", () => {
  // 2 × 529,00 € + 3 × 49,90 € = 1.207,70 €
  const lines = [
    { article: utopia, quantity: 2 },
    { article: lamzac, quantity: 3 },
    { article: { ...lamzac, variantId: "var_ohne_preis", priceCents: null, priceDisplay: null }, quantity: 1 },
  ];
  const totals = offerTotals(lines);
  assert.deepEqual(totals, { pieces: 6, totalCents: 120770, withoutPrice: 1 });
  assert.equal(
    totals.totalCents,
    lines.reduce((sum, l) => sum + (l.article.priceCents ?? 0) * l.quantity, 0),
  );
});

test("parseStoredOffer: verwirft Unlesbares", () => {
  assert.deepEqual(parseStoredOffer(null), []);
  assert.deepEqual(parseStoredOffer("{kaputt"), []);
  assert.deepEqual(parseStoredOffer(JSON.stringify([{ article: utopia, quantity: 2 }, { quantity: 1 }, { article: lamzac, quantity: 0 }])), [{ article: utopia, quantity: 2 }]);
});

const antwortUtopia = {
  code: "242022",
  data: [
    {
      productId: "prd_1",
      productNumber: "A-001711",
      name: "2024 Ronix One – Legacy Core – Glossy Black / Matte White",
      brand: "Ronix",
      status: "ACTIVE",
      variantId: "var_ronix_one_142",
      sku: "242022",
      gtin: null,
      options: ["142 cm"],
      isActive: true,
      condition: "NEW",
      conditionNote: null,
      conditionBadge: null,
      price: { amount: "529.00", currency: "EUR", display: "529 €" },
      msrp: { amount: "659.99", display: "659,99 €" },
      saving: "Du sparst 19 %",
      imageUrl: "https://k42vwsdzgkg7zhzx.public.blob.vercel-storage.com/produktbilder/zuschnitt/a0/a0cfd81442af338a1aa221d3a4c0b88a.webp",
      link: "HTTPS://4WAKE.EU/A/242022",
      matchedBy: "sku",
    },
  ],
};

test("articlesFromLookup: übernimmt Preis in Cent und Anzeige aus dem Shop", () => {
  const result = articlesFromLookup(antwortUtopia);
  assert.ok(result);
  assert.equal(result.code, "242022");
  assert.deepEqual(result.articles[0], {
    ...utopia,
    imageUrl: "https://k42vwsdzgkg7zhzx.public.blob.vercel-storage.com/produktbilder/zuschnitt/a0/a0cfd81442af338a1aa221d3a4c0b88a.webp",
  });
  assert.equal(articlesFromLookup({ data: "x" }), null);
});

test("articlesFromLookup: ohne Preis und mit http-Bild bleibt beides leer", () => {
  const ohnePreis = { ...antwortUtopia, data: [{ ...antwortUtopia.data[0], price: null, msrp: null, saving: null, imageUrl: "http://example.test/x.jpg", status: "DRAFT" }] };
  const [artikel] = articlesFromLookup(ohnePreis)!.articles;
  assert.equal(artikel!.priceCents, null);
  assert.equal(artikel!.imageUrl, null);
  assert.equal(artikel!.online, false);
});

test("empShopBaseUrl: Standardadresse, ohne Schrägstrich, nur https", () => {
  assert.equal(empShopBaseUrl(null), "https://emp-shop-backoffice.vercel.app");
  assert.equal(empShopBaseUrl(" https://backoffice.4wake.eu/ "), "https://backoffice.4wake.eu");
  assert.equal(empShopBaseUrl("http://example.com"), null);
  assert.equal(empShopBaseUrl("http://localhost:3001"), "http://localhost:3001");
  assert.equal(empShopBaseUrl("kein link"), null);
});

test("lookupEmpShopArticles: fragt mit Schlüssel und übersetzt Fehler", async () => {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const ok: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify(antwortUtopia), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await lookupEmpShopArticles({ token: "emp_test_geheim", baseUrl: null }, "35018.240400-SD-S/M", ok);
  assert.equal(result.ok, true);
  assert.equal(calls[0]!.url, "https://emp-shop-backoffice.vercel.app/api/v1/products/lookup?code=35018.240400-SD-S%2FM");
  assert.equal(calls[0]!.auth, "Bearer emp_test_geheim");

  const abgelehnt: typeof fetch = async () => new Response("{}", { status: 401 });
  const r401 = await lookupEmpShopArticles({ token: "x", baseUrl: null }, "242022", abgelehnt);
  assert.equal(r401.ok, false);
  assert.match(r401.ok ? "" : r401.message, /API-Schlüssel/);

  const weg: typeof fetch = async () => { throw new Error("offline"); };
  const r502 = await lookupEmpShopArticles({ token: "x", baseUrl: null }, "242022", weg);
  assert.deepEqual(r502.ok ? null : r502.status, 502);
});
