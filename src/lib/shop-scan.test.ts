import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addToOffer,
  amountE4,
  applyOfferDiscount,
  CAMERA_SAME_CODE_GAP_MS,
  cameraCodeGate,
  centsFromAmount,
  centsFromInput,
  formatEuro,
  formatPercent,
  isShopLabelScan,
  isValidShopCostPin,
  isWeakShopCostPin,
  lineCostView,
  mirrorCameraPreview,
  offerMargin,
  offerTotals,
  parseDiscountInput,
  parseStoredDiscount,
  parseStoredOffer,
  setOfferQuantity,
  shopLabelCode,
  shopScanCode,
  type ShopArticle,
  type ShopCost,
} from "./shop-scan";
import {
  articlesFromLookup,
  costsFromResponse,
  EMP_SHOP_COSTS_SCOPE_MESSAGE,
  empShopBaseUrl,
  fetchEmpShopCosts,
  lookupEmpShopArticles,
} from "./emp-shop-client";

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

test("cameraCodeGate: liegt das Etikett vor der Kamera, zählt es nur einmal", () => {
  let last: { code: string; at: number } | null = null;
  const sieht = (code: string, at: number) => {
    const r = cameraCodeGate(last, code, at);
    last = r.last;
    return r.report;
  };
  // Ronix One: erster Treffer zählt, dieselben Bilder danach nicht, auch nach 10 Sekunden im Bild nicht
  assert.equal(sieht("HTTPS://4WAKE.EU/A/242022", 0), true);
  for (let t = 150; t <= 10_000; t += 150) assert.equal(sieht("HTTPS://4WAKE.EU/A/242022", t), false);
  // Lamzac dazwischen zählt sofort
  assert.equal(sieht("HTTPS://4WAKE.EU/A/DIV08", 10_100), true);
  // Ronix One wieder: anderer Code davor, also zählt er
  assert.equal(sieht("HTTPS://4WAKE.EU/A/242022", 10_200), true);
  // 1,5 s aus dem Bild: zweites Stück zählt
  assert.equal(sieht("HTTPS://4WAKE.EU/A/242022", 10_200 + CAMERA_SAME_CODE_GAP_MS), true);
});

test("mirrorCameraPreview: Front- und Laptop-Kamera gespiegelt, Rückkamera nicht", () => {
  assert.equal(mirrorCameraPreview("environment", false), false);
  assert.equal(mirrorCameraPreview("environment", true), false);
  assert.equal(mirrorCameraPreview("user", false), true);
  // FaceTime-Kamera am Mac meldet oft keine Richtung
  assert.equal(mirrorCameraPreview(undefined, true), true);
  assert.equal(mirrorCameraPreview(undefined, false), false);
});

test("centsFromInput und parseDiscountInput: deutsche Eingaben", () => {
  assert.equal(centsFromInput("12,5"), 1250);
  assert.equal(centsFromInput("1.086,90 €"), 108690);
  assert.equal(centsFromInput("1086"), 108600);
  assert.equal(centsFromInput("49.9"), 4990);
  assert.equal(centsFromInput("zehn"), null);
  assert.deepEqual(parseDiscountInput("percent", "10"), { kind: "percent", basisPoints: 1000 });
  assert.deepEqual(parseDiscountInput("percent", "12,5 %"), { kind: "percent", basisPoints: 1250 });
  assert.equal(parseDiscountInput("percent", "120"), null);
  assert.equal(parseDiscountInput("percent", "0"), null);
  assert.deepEqual(parseDiscountInput("amount", "50"), { kind: "amount", cents: 5000 });
  assert.deepEqual(parseDiscountInput("total", "1.000"), { kind: "total", cents: 100000 });
  assert.equal(parseDiscountInput("total", "-5"), null);
});

test("applyOfferDiscount: Rabatt auf 2 × Ronix One und 3 × Lamzac", () => {
  // 2 × 529,00 € + 3 × 49,90 € = 1.207,70 €
  const summe = offerTotals([{ article: utopia, quantity: 2 }, { article: lamzac, quantity: 3 }]).totalCents;
  assert.equal(summe, 120770);
  // 10 %: 120,77 € runter, 1.086,93 € bleiben
  assert.deepEqual(applyOfferDiscount(summe, { kind: "percent", basisPoints: 1000 }), { discountCents: 12077, finalCents: 108693 });
  // 12,5 %: 150,9625 € wird kaufmännisch 150,96 €
  assert.deepEqual(applyOfferDiscount(summe, { kind: "percent", basisPoints: 1250 }), { discountCents: 15096, finalCents: 105674 });
  // 7,5 % von 49,90 € = 3,7425 € → 3,74 €; 15 % von 49,90 € = 7,485 € → 7,49 €
  assert.equal(applyOfferDiscount(4990, { kind: "percent", basisPoints: 750 }).discountCents, 374);
  assert.equal(applyOfferDiscount(4990, { kind: "percent", basisPoints: 1500 }).discountCents, 749);
  // Endpreis 1.100 €: 107,70 € Rabatt
  assert.deepEqual(applyOfferDiscount(summe, { kind: "total", cents: 110000 }), { discountCents: 10770, finalCents: 110000 });
  // Betrag 50 €
  assert.deepEqual(applyOfferDiscount(summe, { kind: "amount", cents: 5000 }), { discountCents: 5000, finalCents: 115770 });
  // Nie mehr als die Summe, nie ein Aufschlag
  assert.deepEqual(applyOfferDiscount(4990, { kind: "amount", cents: 10000 }), { discountCents: 4990, finalCents: 0 });
  assert.deepEqual(applyOfferDiscount(4990, { kind: "total", cents: 6000 }), { discountCents: 0, finalCents: 4990 });
  assert.deepEqual(applyOfferDiscount(summe, null), { discountCents: 0, finalCents: summe });
  // Rabatt und Endpreis ergeben zusammen immer die Summe
  for (const d of [{ kind: "percent", basisPoints: 333 }, { kind: "amount", cents: 12345 }, { kind: "total", cents: 99999 }] as const) {
    const r = applyOfferDiscount(summe, d);
    assert.equal(r.discountCents + r.finalCents, summe);
  }
});

test("formatPercent und parseStoredDiscount", () => {
  assert.equal(formatPercent(12077, 120770), "10 %");
  assert.equal(formatPercent(10770, 120770), "8,9 %");
  assert.equal(formatPercent(0, 0), "0 %");
  assert.deepEqual(parseStoredDiscount(JSON.stringify({ kind: "percent", basisPoints: 1000 })), { kind: "percent", basisPoints: 1000 });
  assert.deepEqual(parseStoredDiscount(JSON.stringify({ kind: "total", cents: 110000 })), { kind: "total", cents: 110000 });
  assert.equal(parseStoredDiscount(JSON.stringify({ kind: "percent", basisPoints: 20000 })), null);
  assert.equal(parseStoredDiscount("{kaputt"), null);
  assert.equal(parseStoredDiscount(null), null);
});

/**
 * EK und Marge: Angebot 3 × Ronix One 142 cm (529 €) und 3 × Lamzac (49,90 €)
 * wie im Laden. Ø-EK Ronix One 296,15 €, Lieferantenpreis Lamzac 24,95 €
 * (Beispielwerte), beide 19 %.
 */
const einstand = new Map<string, ShopCost>([
  [utopia.variantId, { unitCostE4: 2_961_500, basis: "AVERAGE_COST", taxBasisPoints: 1900 }],
  [lamzac.variantId, { unitCostE4: 249_500, basis: "SUPPLIER_PRICE", taxBasisPoints: 1900 }],
]);
const angebot = [{ article: utopia, quantity: 3 }, { article: lamzac, quantity: 3 }];

test("amountE4: Beträge mit vier Nachkommastellen ohne Gleitkomma", () => {
  assert.equal(amountE4("214.5000"), 2_145_000);
  assert.equal(amountE4("24.95"), 249_500);
  assert.equal(amountE4("0.0001"), 1);
  assert.equal(amountE4("12"), 120_000);
  assert.equal(amountE4("-3.00"), null);
  assert.equal(amountE4("1.23456"), null);
  assert.equal(amountE4(null), null);
});

test("lineCostView: EK und Marge je Stück zum Etikettenpreis", () => {
  // 529 € brutto = 444,54 € netto, minus 296,15 € EK = 148,39 € (33,4 %)
  const one = lineCostView(52900, einstand.get(utopia.variantId));
  assert.deepEqual(one, { unitCostCents: 29615, marginCents: 14839, netCents: 44454 });
  assert.equal(formatPercent(one!.marginCents!, one!.netCents!), "33,4 %");
  // 49,90 € brutto = 41,93 € netto, minus 24,95 € = 16,98 €
  assert.deepEqual(lineCostView(4990, einstand.get(lamzac.variantId)), { unitCostCents: 2495, marginCents: 1698, netCents: 4193 });
  assert.equal(lineCostView(4990, { unitCostE4: null, basis: null, taxBasisPoints: 1900 }), null);
  assert.equal(lineCostView(4990, undefined), null);
  assert.deepEqual(lineCostView(null, einstand.get(lamzac.variantId)), { unitCostCents: 2495, marginCents: null, netCents: null });
});

test("offerMargin: Marge und Spielraum ohne Rabatt", () => {
  const m = offerMargin(angebot, einstand, 0);
  // Netto 1.459,41 €, EK 3 × 296,15 € + 3 × 24,95 € = 963,30 €
  // Untergrenze: 963,30 € × 1,19 = 1.146,327 € → 1.146,33 €; Spielraum 1.736,70 € − 1.146,33 €
  assert.deepEqual(m, { pending: 0, withoutCost: 0, costCents: 96330, netCents: 145941, marginCents: 49611, breakEvenCents: 114633, roomCents: 59037 });
  assert.equal(formatPercent(m.marginCents, m.netCents), "34 %");
  // EK netto + Marge = Netto
  assert.equal(m.costCents + m.marginCents, m.netCents);
});

test("offerMargin: Rabatt senkt Marge und Spielraum, unter EK wird es negativ", () => {
  const summe = offerTotals(angebot).totalCents;
  assert.equal(summe, 173670);
  // 10 %: 173,67 € Rabatt, Netto 1.313,47 €, Marge 350,17 € (26,7 %), noch 416,70 € Spielraum
  const zehn = applyOfferDiscount(summe, { kind: "percent", basisPoints: 1000 });
  const m10 = offerMargin(angebot, einstand, zehn.discountCents);
  assert.deepEqual(m10, { pending: 0, withoutCost: 0, costCents: 96330, netCents: 131347, marginCents: 35017, breakEvenCents: 114633, roomCents: 41670 });
  assert.equal(formatPercent(m10.marginCents, m10.netCents), "26,7 %");
  // Der Spielraum zusätzlich als Rabatt führt genau auf den Einstand
  const amLimit = offerMargin(angebot, einstand, zehn.discountCents + m10.roomCents!);
  assert.ok(amLimit.marginCents >= 0 && amLimit.marginCents <= 1, `Marge am Limit: ${amLimit.marginCents}`);
  assert.equal(amLimit.roomCents, 0);
  // Endpreis 1.100 €: 38,93 € unter Einstand
  const endpreis = applyOfferDiscount(summe, { kind: "total", cents: 110000 });
  const mEnd = offerMargin(angebot, einstand, endpreis.discountCents);
  assert.deepEqual(mEnd, { pending: 0, withoutCost: 0, costCents: 96330, netCents: 92437, marginCents: -3893, breakEvenCents: 114633, roomCents: 0 });
});

test("offerMargin: ohne EK und noch ladend zählt nicht mit, Spielraum offen", () => {
  const ohneEk = new Map(einstand);
  ohneEk.set(lamzac.variantId, { unitCostE4: null, basis: null, taxBasisPoints: 1900 });
  const m = offerMargin(angebot, ohneEk, 0);
  // Nur der Ronix One: Netto 3 × 444,537… = 1.333,61 €, EK 888,45 €
  assert.deepEqual(m, { pending: 0, withoutCost: 1, costCents: 88845, netCents: 133361, marginCents: 44516, breakEvenCents: null, roomCents: null });
  const laedt = offerMargin(angebot, new Map([[utopia.variantId, einstand.get(utopia.variantId)!]]), 0);
  assert.equal(laedt.pending, 1);
  assert.equal(laedt.roomCents, null);
  // Positionen ohne Preis bleiben draußen
  const ohnePreis = offerMargin([{ article: { ...lamzac, priceCents: null }, quantity: 2 }], einstand, 0);
  assert.deepEqual(ohnePreis, { pending: 0, withoutCost: 0, costCents: 0, netCents: 0, marginCents: 0, breakEvenCents: null, roomCents: null });
  // 7 % (Buch) rechnet mit dem eigenen Satz: 21,40 € brutto = 20,00 € netto
  const buch = offerMargin([{ article: { ...lamzac, variantId: "buch", priceCents: 2140 }, quantity: 1 }], new Map([["buch", { unitCostE4: 150_000, basis: "SUPPLIER_PRICE", taxBasisPoints: 700 }]]), 0);
  assert.equal(buch.netCents, 2000);
  assert.equal(buch.marginCents, 500);
});

test("isValidShopCostPin und isWeakShopCostPin", () => {
  assert.equal(isValidShopCostPin("482915"), true);
  assert.equal(isValidShopCostPin("48291537"), true);
  assert.equal(isValidShopCostPin("4829"), true);
  assert.equal(isValidShopCostPin("482"), false);
  assert.equal(isValidShopCostPin("482915370"), false);
  assert.equal(isValidShopCostPin("48291a"), false);
  assert.equal(isWeakShopCostPin("111111"), true);
  assert.equal(isWeakShopCostPin("1111"), true);
  assert.equal(isWeakShopCostPin("1234"), true);
  assert.equal(isWeakShopCostPin("4321"), true);
  assert.equal(isWeakShopCostPin("4829"), false);
  assert.equal(isWeakShopCostPin("123456"), true);
  assert.equal(isWeakShopCostPin("87654321"), true);
  assert.equal(isWeakShopCostPin("890123"), false);
  assert.equal(isWeakShopCostPin("482915"), false);
});

test("costsFromResponse und fetchEmpShopCosts: Einstand aus dem EMP-Shop", async () => {
  const antwort = {
    data: [
      { variantId: utopia.variantId, unitCost: "296.1500", costBasis: "AVERAGE_COST", currency: "EUR", taxRate: "19.00" },
      { variantId: lamzac.variantId, unitCost: null, costBasis: null, currency: "EUR", taxRate: "19.00" },
    ],
  };
  assert.deepEqual(costsFromResponse(antwort), [
    { variantId: utopia.variantId, unitCostE4: 2_961_500, basis: "AVERAGE_COST", taxBasisPoints: 1900 },
    { variantId: lamzac.variantId, unitCostE4: null, basis: null, taxBasisPoints: 1900 },
  ]);
  assert.equal(costsFromResponse({ data: [{ ...antwort.data[0], taxRate: "neunzehn" }] }), null);
  assert.equal(costsFromResponse({ nichts: true }), null);

  const calls: Array<{ url: string; auth: string | null }> = [];
  const ok: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify(antwort), { status: 200, headers: { "content-type": "application/json" } });
  };
  const r = await fetchEmpShopCosts({ token: "emp_test_geheim", baseUrl: null }, [utopia.variantId, lamzac.variantId], ok);
  assert.equal(r.ok, true);
  assert.equal(calls[0]!.url, `https://emp-shop-backoffice.vercel.app/api/v1/products/costs?variantIds=${utopia.variantId}%2C${lamzac.variantId}`);
  assert.equal(calls[0]!.auth, "Bearer emp_test_geheim");

  // Ohne Positionen kein Aufruf
  assert.deepEqual(await fetchEmpShopCosts({ token: "x", baseUrl: null }, [], async () => { throw new Error("nicht aufrufen"); }), { ok: true, costs: [] });
  // Schlüssel ohne „Einkaufspreise lesen“
  const ohneRecht: typeof fetch = async () => new Response("{}", { status: 403 });
  const r403 = await fetchEmpShopCosts({ token: "x", baseUrl: null }, ["a"], ohneRecht);
  assert.deepEqual(r403, { ok: false, status: 409, message: EMP_SHOP_COSTS_SCOPE_MESSAGE });
  assert.match(EMP_SHOP_COSTS_SCOPE_MESSAGE, /Einkaufspreise lesen \(Ø-EK\)/);
  const weg: typeof fetch = async () => { throw new Error("offline"); };
  assert.equal((await fetchEmpShopCosts({ token: "x", baseUrl: null }, ["a"], weg)).ok, false);
});
