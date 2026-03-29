import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncAnnyForAccount } from "@/lib/anny-sync";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET nicht gesetzt" }, { status: 503 });
  }

  const auth = request.headers.get("authorization")?.trim();
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  if (bearer !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configs = await prisma.apiConfig.findMany({
    where: { provider: "ANNY" },
    select: { accountId: true },
  });

  if (configs.length === 0) {
    return NextResponse.json({ message: "Keine ANNY-Integrationen konfiguriert" });
  }

  const results: { accountId: number; ok: boolean; created?: number; updated?: number; error?: string }[] = [];

  for (const config of configs) {
    try {
      const result = await syncAnnyForAccount(config.accountId);
      results.push({
        accountId: config.accountId,
        ok: true,
        created: result.created,
        updated: result.updated,
      });
    } catch (err) {
      results.push({
        accountId: config.accountId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(`[cron anny-sync] ${results.length} accounts synced: ${results.filter((r) => r.ok).length} ok, ${results.filter((r) => !r.ok).length} failed`);

  return NextResponse.json({ synced: results.length, results });
}
