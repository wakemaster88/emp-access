import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncAnnyForAccount } from "@/lib/anny-sync";

// Voll-Sync, angestossen ueber den Checkin-Monitor. Bewusst niedriger als der
// Cron (300s): der Endpoint haengt nur an einem Monitor-Token, soll also nicht
// beliebig lange Funktionslaufzeit binden koennen.
export const maxDuration = 120;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const annyConfig = await prisma.apiConfig.findFirst({
    where: { accountId: monitor.accountId, provider: "ANNY" },
    select: { id: true },
  });
  if (!annyConfig) {
    return NextResponse.json({ error: "Keine ANNY-Integration konfiguriert" }, { status: 404 });
  }

  try {
    const result = await syncAnnyForAccount(monitor.accountId);
    return NextResponse.json({
      ok: true,
      created: result.created,
      updated: result.updated,
      errors: result.errors,
      errorDetails: result.errorDetails,
      total: result.total,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
