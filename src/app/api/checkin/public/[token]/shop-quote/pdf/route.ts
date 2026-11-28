import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicLinkRateLimit } from "@/lib/rate-limit";
import { fetchEmpShopQuotePdf } from "@/lib/emp-shop-client";
import { shopQuoteTicketQuoteId } from "@/lib/shop-quote-ticket";

/**
 * PDF zum eben angelegten Angebot für den Druck am Monitor (28.11.2026), nur
 * mit dem Beleg aus POST …/shop-quote. Per POST, damit der Beleg nicht in
 * einer Adresse steht; das PDF wird nicht zwischengespeichert.
 */

const PDF_LIMIT = { limit: 30, windowMs: 60_000 } as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "checkin-shop-quote-pdf", PDF_LIMIT);
  if (limited) return limited;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token }, select: { id: true, isActive: true, type: true, accountId: true } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { ticket?: unknown } | null;
  const quoteId = shopQuoteTicketQuoteId(body?.ticket, monitor.accountId, monitor.id);
  if (!quoteId) return NextResponse.json({ error: "Das Angebot ist zu alt für den Druck hier. Bitte im EMP-Shop drucken." }, { status: 410, headers: { "cache-control": "no-store" } });

  const config = await prisma.apiConfig.findFirst({ where: { accountId: monitor.accountId, provider: "EMP_SHOP" }, select: { token: true, baseUrl: true } });
  if (!config?.token) return NextResponse.json({ error: "Der EMP-Shop ist nicht verbunden." }, { status: 409 });
  const result = await fetchEmpShopQuotePdf(config, quoteId);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status, headers: { "cache-control": "no-store" } });
  return new NextResponse(result.pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${result.fileName.replace(/[^\w.-]/g, "_")}"`,
      "cache-control": "no-store",
    },
  });
}
