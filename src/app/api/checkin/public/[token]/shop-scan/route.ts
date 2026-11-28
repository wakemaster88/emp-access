import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicLinkRateLimit } from "@/lib/rate-limit";
import { lookupEmpShopArticles } from "@/lib/emp-shop-client";
import { shopScanCode } from "@/lib/shop-scan";

/**
 * Shop-Scan im Shop-Monitor (28.11.2026): gescanntes Preisetikett, Artikelnummer
 * oder EAN im EMP-Shop nachschlagen. Tenant über den Monitor-Token wie bei den
 * anderen Kassen-Overlays; der API-Schlüssel des Shops bleibt auf dem Server.
 * Nur lesend: zusammengestellt wird im Browser des Kiosks.
 */

/** Ein Handscanner liest schnell, aber kaum mehr als zwei Etiketten je Sekunde. */
const SHOP_SCAN_LIMIT = { limit: 120, windowMs: 60_000 } as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "checkin-shop-scan", SHOP_SCAN_LIMIT);
  if (limited) return limited;
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { isActive: true, type: true, accountId: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? shopScanCode(body.code) : "";
  if (!code) return NextResponse.json({ error: "Kein Code gelesen." }, { status: 400 });
  if (code.length > 200) return NextResponse.json({ error: "Der Code ist zu lang." }, { status: 400 });

  const config = await prisma.apiConfig.findFirst({
    where: { accountId: monitor.accountId, provider: "EMP_SHOP" },
    select: { token: true, baseUrl: true },
  });
  if (!config?.token) {
    return NextResponse.json(
      { error: "Der EMP-Shop ist nicht verbunden. Bitte unter Einstellungen › Integrationen den API-Schlüssel eintragen." },
      { status: 409 },
    );
  }

  const result = await lookupEmpShopArticles(config, code);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
  return NextResponse.json({ code: result.code, articles: result.articles });
}
