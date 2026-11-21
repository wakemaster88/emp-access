import { NextRequest, NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadPaymentOpen, paymentOpenTotal } from "@/lib/payment-open";

/**
 * Abos mit „Zahlung offen“ für die Kasse (Checkin-Monitor). Tenant über den
 * Monitor-Token wie bei den anderen Kassen-Overlays; ohne E-Mail-Adressen.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { isActive: true, type: true, accountId: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  const rows = await loadPaymentOpen(prisma as unknown as PrismaClient, monitor.accountId);
  return NextResponse.json({
    total: paymentOpenTotal(rows),
    rows: rows.map((r) => ({ ...r, email: undefined })),
  });
}
