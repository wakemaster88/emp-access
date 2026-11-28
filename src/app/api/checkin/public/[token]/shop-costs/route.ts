import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicLinkRateLimit } from "@/lib/rate-limit";
import { fetchEmpShopCosts } from "@/lib/emp-shop-client";
import {
  checkShopCostPin,
  issueShopCostUnlock,
  SHOP_COST_PIN_LOCK_MINUTES,
  SHOP_COST_PIN_MAX_FAILURES,
  shopCostPinRow,
  shopCostUnlockValid,
} from "@/lib/shop-cost-pin";
import { SHOP_COSTS_MAX_VARIANTS } from "@/lib/shop-scan";

/**
 * EK und Marge im Shop-Monitor (28.11.2026): Einstand der Positionen aus dem
 * EMP-Shop, erst nach der PIN aus Einstellungen › Integrationen › EMP-Shop.
 *
 * Body: `{ pin, variantIds }` beim Einschalten, danach `{ unlock, variantIds }`
 * mit der Freischaltung aus der ersten Antwort. Der API-Schlüssel des Shops und
 * der PIN-Hash bleiben auf dem Server; die Antwort wird nicht zwischengespeichert.
 */

const SHOP_COSTS_LIMIT = { limit: 60, windowMs: 60_000 } as const;
const VARIANT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const NO_STORE = { "cache-control": "no-store" } as const;

function fail(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "checkin-shop-costs", SHOP_COSTS_LIMIT);
  if (limited) return limited;
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { id: true, isActive: true, type: true, accountId: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") return fail("Nicht gefunden", 404);

  const body = (await request.json().catch(() => null)) as { pin?: unknown; unlock?: unknown; variantIds?: unknown } | null;
  const rawIds: unknown[] = Array.isArray(body?.variantIds) ? body.variantIds : [];
  if (rawIds.some((v) => typeof v !== "string" || !VARIANT_ID.test(v))) return fail("Ungültige Positionen.", 400);
  const variantIds = [...new Set(rawIds as string[])];
  if (variantIds.length > SHOP_COSTS_MAX_VARIANTS) return fail(`Höchstens ${SHOP_COSTS_MAX_VARIANTS} Positionen auf einmal.`, 400);

  const row = await shopCostPinRow(monitor.accountId);
  if (!row) {
    return fail("Für EK und Marge ist noch keine PIN festgelegt. Bitte unter Einstellungen › Integrationen › EMP-Shop eine PIN setzen.", 409);
  }

  const now = new Date();
  let unlock: { unlock: string; expiresAt: string } | null = null;
  if (typeof body?.pin === "string") {
    const check = await checkShopCostPin(monitor.accountId, body.pin.trim(), now);
    if (!check.ok) {
      if (check.reason === "missing") return fail("Für EK und Marge ist keine PIN mehr festgelegt.", 409);
      if (check.reason === "locked") {
        const minutes = Math.max(1, Math.ceil((check.lockedUntil.getTime() - now.getTime()) / 60_000));
        return fail(`Zu viele falsche PINs. EK und Marge sind für ${minutes} Minute${minutes === 1 ? "" : "n"} gesperrt.`, 429, { pin: true });
      }
      return fail(
        `PIN falsch. Nach ${SHOP_COST_PIN_MAX_FAILURES} Fehlversuchen sind EK und Marge ${SHOP_COST_PIN_LOCK_MINUTES} Minuten gesperrt.`,
        403,
        { pin: true },
      );
    }
    unlock = issueShopCostUnlock(monitor.accountId, monitor.id, check.pinSetAt, now);
  } else if (typeof body?.unlock === "string") {
    if (!shopCostUnlockValid(body.unlock, monitor.accountId, monitor.id, row.pinSetAt, now)) {
      return fail("Bitte die PIN erneut eingeben.", 401, { pin: true });
    }
  } else {
    return fail("PIN fehlt.", 401, { pin: true });
  }

  const config = await prisma.apiConfig.findFirst({
    where: { accountId: monitor.accountId, provider: "EMP_SHOP" },
    select: { token: true, baseUrl: true },
  });
  if (!config?.token) {
    return fail("Der EMP-Shop ist nicht verbunden. Bitte unter Einstellungen › Integrationen den API-Schlüssel eintragen.", 409);
  }

  const result = await fetchEmpShopCosts(config, variantIds);
  if (!result.ok) return fail(result.message, result.status, unlock ?? {});
  return NextResponse.json({ ...(unlock ?? {}), costs: result.costs }, { headers: NO_STORE });
}
