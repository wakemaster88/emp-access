import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { removeShopCostPin, setShopCostPin, shopCostPinRow, type ShopCostPinDb } from "@/lib/shop-cost-pin";
import { isValidShopCostPin, isWeakShopCostPin } from "@/lib/shop-scan";

/**
 * PIN für EK und Marge im Shop-Monitor (28.11.2026): festlegen, ersetzen oder
 * entfernen, nur für Admins wie die übrigen Integrationen. Die PIN selbst und
 * ihr Hash gehen nie zurück an den Browser, nur ob eine gesetzt ist.
 */

async function adminDb() {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return { error: session.error };
  const { db, accountId } = session;
  if (!accountId) return { error: NextResponse.json({ error: "Kein Account zugeordnet" }, { status: 403 }) };
  return { db: db as unknown as ShopCostPinDb, accountId };
}

export async function GET() {
  const s = await adminDb();
  if ("error" in s) return s.error;
  const row = await shopCostPinRow(s.accountId, s.db);
  return NextResponse.json({
    pinSet: !!row,
    pinSetAt: row?.pinSetAt.toISOString() ?? null,
    lockedUntil: row?.lockedUntil && row.lockedUntil > new Date() ? row.lockedUntil.toISOString() : null,
  });
}

export async function PUT(request: NextRequest) {
  const s = await adminDb();
  if ("error" in s) return s.error;
  const body = (await request.json().catch(() => null)) as { pin?: unknown } | null;
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
  if (!isValidShopCostPin(pin)) return NextResponse.json({ error: "Die PIN muss aus 6 bis 8 Ziffern bestehen." }, { status: 400 });
  if (isWeakShopCostPin(pin)) {
    return NextResponse.json({ error: "Bitte keine PIN aus gleichen oder fortlaufenden Ziffern." }, { status: 400 });
  }
  await setShopCostPin(s.accountId, pin, new Date(), s.db);
  return NextResponse.json({ pinSet: true });
}

export async function DELETE() {
  const s = await adminDb();
  if ("error" in s) return s.error;
  await removeShopCostPin(s.accountId, s.db);
  return NextResponse.json({ pinSet: false });
}
