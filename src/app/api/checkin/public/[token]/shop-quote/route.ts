import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicLinkRateLimit } from "@/lib/rate-limit";
import { createEmpShopQuote } from "@/lib/emp-shop-client";
import {
  checkShopCostPin,
  issueShopCostUnlock,
  SHOP_COST_PIN_LOCK_MINUTES,
  SHOP_COST_PIN_MAX_FAILURES,
  shopCostPinRow,
  shopCostUnlockValid,
} from "@/lib/shop-cost-pin";
import { empShopQuoteBody, parseShopQuoteRequest, type ShopQuoteView } from "@/lib/shop-quote";
import { issueShopQuoteTicket } from "@/lib/shop-quote-ticket";
import { centsFromAmount } from "@/lib/shop-scan";

/**
 * Angebot erstellen im Shop-Monitor (28.11.2026): legt das Angebot vom
 * Bildschirm im EMP-Shop an (`POST /api/v1/quotes`), der es druckt oder das
 * PDF für den Druck am Monitor bereithält.
 *
 * Body: `{ items, discount, customer: { name, email }, expectedTotalCents,
 * requestKey }`. Mit Rabatt zusätzlich `pin` oder `unlock` (dieselbe PIN wie
 * für EK und Marge), damit sich am Monitor niemand selbst Rabatt gibt. Die
 * Antwort trägt einen Beleg (`ticket`) für das PDF, nie die Kennung im Shop.
 */

const SHOP_QUOTE_LIMIT = { limit: 20, windowMs: 60_000 } as const;
const NO_STORE = { "cache-control": "no-store" } as const;

function fail(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "checkin-shop-quote", SHOP_QUOTE_LIMIT);
  if (limited) return limited;
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { id: true, name: true, isActive: true, type: true, accountId: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") return fail("Nicht gefunden", 404);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseShopQuoteRequest(body);
  if (!parsed.ok) return fail(parsed.error, 400);
  const quote = parsed.value;

  // Rabatt nur mit der PIN von EK und Marge
  const now = new Date();
  let unlock: { unlock: string; expiresAt: string } | null = null;
  if (quote.discount) {
    const row = await shopCostPinRow(monitor.accountId);
    if (!row) {
      return fail("Ein Angebot mit Rabatt braucht die PIN. Bitte zuerst unter Einstellungen › Integrationen › EMP-Shop eine PIN festlegen.", 409);
    }
    if (typeof body?.pin === "string") {
      const check = await checkShopCostPin(monitor.accountId, body.pin.trim(), now);
      if (!check.ok) {
        if (check.reason === "missing") return fail("Für Rabatt-Angebote ist keine PIN mehr festgelegt.", 409);
        if (check.reason === "locked") {
          const minutes = Math.max(1, Math.ceil((check.lockedUntil.getTime() - now.getTime()) / 60_000));
          return fail(`Zu viele falsche PINs. Rabatt-Angebote sind für ${minutes} Minute${minutes === 1 ? "" : "n"} gesperrt.`, 429, { pin: true });
        }
        return fail(`PIN falsch. Nach ${SHOP_COST_PIN_MAX_FAILURES} Fehlversuchen ist die PIN ${SHOP_COST_PIN_LOCK_MINUTES} Minuten gesperrt.`, 403, { pin: true });
      }
      unlock = issueShopCostUnlock(monitor.accountId, monitor.id, check.pinSetAt, now);
    } else if (typeof body?.unlock === "string") {
      if (!shopCostUnlockValid(body.unlock, monitor.accountId, monitor.id, row.pinSetAt, now)) return fail("Bitte die PIN erneut eingeben.", 401, { pin: true });
    } else {
      return fail("Für ein Angebot mit Rabatt bitte die PIN eingeben.", 401, { pin: true });
    }
  }

  const config = await prisma.apiConfig.findFirst({
    where: { accountId: monitor.accountId, provider: "EMP_SHOP" },
    select: { token: true, baseUrl: true },
  });
  if (!config?.token) {
    return fail("Der EMP-Shop ist nicht verbunden. Bitte unter Einstellungen › Integrationen den API-Schlüssel eintragen.", 409, unlock ?? {});
  }

  const result = await createEmpShopQuote(
    config,
    empShopQuoteBody(quote, `${monitor.name} (EMP-Access)`),
    `emp-access-${monitor.id}-${quote.requestKey}`,
  );
  if (!result.ok) {
    return fail(result.message, result.status, { ...(unlock ?? {}), ...(result.grossTotalCents !== undefined ? { grossTotalCents: result.grossTotalCents } : {}) });
  }
  const q = result.quote;
  const view: ShopQuoteView = {
    number: q.number,
    grossTotalCents: centsFromAmount(q.grossTotal) ?? quote.expectedTotalCents,
    validUntil: q.validUntil,
    customerName: q.customer.name,
    customerNumber: q.customer.number,
    matched: q.customer.matched,
    print: q.print.route,
    printerName: q.print.printerName,
    printMessage: q.print.message,
  };
  return NextResponse.json(
    { ...(unlock ?? {}), quote: view, ticket: issueShopQuoteTicket(monitor.accountId, monitor.id, q.id, now) },
    { status: 201, headers: NO_STORE },
  );
}
