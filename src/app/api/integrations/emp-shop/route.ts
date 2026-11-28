import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { lookupEmpShopArticles } from "@/lib/emp-shop-client";
import { shopScanCode } from "@/lib/shop-scan";

/**
 * Verbindung zum EMP-Shop in den Einstellungen prüfen: einen Code (Etikett,
 * Artikelnummer oder EAN) mit dem gespeicherten Schlüssel nachschlagen.
 * Nur für Admins, wie die übrigen Integrationen.
 */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  if (!accountId) return NextResponse.json({ error: "Kein Account zugeordnet" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? shopScanCode(body.code) : "";
  if (!code) return NextResponse.json({ error: "Kein Code eingegeben" }, { status: 400 });

  const config = await db.apiConfig.findFirst({
    where: { accountId, provider: "EMP_SHOP" },
    select: { token: true, baseUrl: true },
  });
  if (!config?.token) return NextResponse.json({ error: "Erst den API-Schlüssel speichern." }, { status: 409 });

  const result = await lookupEmpShopArticles(config, code);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
  return NextResponse.json({ code: result.code, articles: result.articles });
}
