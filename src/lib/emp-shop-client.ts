import { z } from "zod";
import { centsFromAmount, type ShopArticle } from "./shop-scan";

/**
 * Anbindung an den EMP-Shop (Integration `EMP_SHOP`, Einstellungen ›
 * Integrationen): API-Schlüssel mit der Berechtigung „Artikel und Preise
 * lesen“ (`products.read`) aus EMP-Shop › Einstellungen › API, dazu die
 * Adresse des Backoffice, unter der die Public API liegt.
 *
 * Nur lesend. Der Schlüssel bleibt auf dem Server; der Kiosk fragt über
 * POST /api/checkin/public/[token]/shop-scan.
 */

/** Backoffice des EMP-Shops, wenn in der Integration keine Adresse steht. */
export const EMP_SHOP_DEFAULT_URL = "https://emp-shop-backoffice.vercel.app";

/** Länger wartet der Kiosk nicht auf den Shop. */
const TIMEOUT_MS = 8_000;

const amountSchema = z.object({ amount: z.string(), display: z.string() });

const matchSchema = z.object({
  variantId: z.string(),
  sku: z.string(),
  productNumber: z.string(),
  name: z.string(),
  brand: z.string().nullable().optional(),
  status: z.string(),
  options: z.array(z.string()).default([]),
  conditionBadge: z.string().nullable().optional(),
  conditionNote: z.string().nullable().optional(),
  price: amountSchema.extend({ currency: z.string() }).nullable(),
  msrp: amountSchema.nullable().optional(),
  saving: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
});

const responseSchema = z.object({ code: z.string(), data: z.array(matchSchema) });

export type EmpShopLookup =
  | { ok: true; code: string; articles: ShopArticle[] }
  | { ok: false; status: number; message: string };

/** Antwort des EMP-Shops in die Anzeige des Kiosks übersetzen. */
export function articlesFromLookup(json: unknown): { code: string; articles: ShopArticle[] } | null {
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return null;
  return {
    code: parsed.data.code,
    articles: parsed.data.data.map((m) => {
      // Nur Euro-Preise rechnen mit; ein anderer Standardmarkt bliebe ohne Summe.
      const euro = m.price && m.price.currency === "EUR" ? m.price : null;
      return {
        variantId: m.variantId,
        sku: m.sku,
        productNumber: m.productNumber,
        name: m.name,
        brand: m.brand ?? null,
        options: m.options,
        conditionBadge: m.conditionBadge ?? null,
        conditionNote: m.conditionNote ?? null,
        priceCents: euro ? centsFromAmount(euro.amount) : null,
        priceDisplay: euro?.display ?? null,
        msrpDisplay: m.msrp?.display ?? null,
        saving: m.saving ?? null,
        imageUrl: m.imageUrl && /^https:\/\//i.test(m.imageUrl) ? m.imageUrl : null,
        online: m.status === "ACTIVE",
      };
    }),
  };
}

/** Basisadresse ohne Schrägstrich am Ende; nur https (lokal auch http). */
export function empShopBaseUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim() || EMP_SHOP_DEFAULT_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) return null;
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Artikel zu einem gescannten Code im EMP-Shop nachschlagen. */
export async function lookupEmpShopArticles(
  config: { token: string; baseUrl: string | null },
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EmpShopLookup> {
  const base = empShopBaseUrl(config.baseUrl);
  if (!base) return { ok: false, status: 409, message: "Die Adresse des EMP-Shops in den Einstellungen ist ungültig." };
  let res: Response;
  try {
    res = await fetchImpl(`${base}/api/v1/products/lookup?${new URLSearchParams({ code }).toString()}`, {
      headers: { authorization: `Bearer ${config.token}`, accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 502, message: "Der EMP-Shop antwortet nicht. Bitte gleich noch einmal scannen." };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: 409, message: "Der EMP-Shop lehnt den API-Schlüssel ab. Bitte in den Einstellungen einen Schlüssel mit „Artikel und Preise lesen“ eintragen." };
  }
  if (res.status === 429) return { ok: false, status: 429, message: "Zu viele Scans auf einmal. Bitte kurz warten." };
  if (!res.ok) return { ok: false, status: 502, message: "Der EMP-Shop konnte den Code gerade nicht prüfen." };
  const result = articlesFromLookup(await res.json().catch(() => null));
  if (!result) return { ok: false, status: 502, message: "Der EMP-Shop hat unerwartet geantwortet." };
  return { ok: true, ...result };
}
