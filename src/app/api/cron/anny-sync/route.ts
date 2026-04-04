import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncAnnyForAccount } from "@/lib/anny-sync";

export const maxDuration = 60;

function verifyCronAuth(request: NextRequest): { ok: true } | { ok: false; status: number; body: object } {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      body: {
        error: "CRON_SECRET ist nicht gesetzt",
        hint: "In Vercel: Projekt → Settings → Environment Variables → CRON_SECRET (min. 16 Zeichen). Nach dem Anlegen neu deployen.",
      },
    };
  }
  const auth = request.headers.get("authorization")?.trim();
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  if (bearer !== secret) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "Unauthorized",
        hint: "Vercel sendet Authorization: Bearer <CRON_SECRET>. Wert in Vercel muss exakt mit CRON_SECRET übereinstimmen.",
        hasAuthHeader: !!auth,
      },
    };
  }
  return { ok: true };
}

export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request);
  if (!authResult.ok) {
    console.warn(`[cron anny-sync] Auth failed:`, JSON.stringify(authResult.body));
    return NextResponse.json(authResult.body, { status: authResult.status });
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
      console.log(`[cron anny-sync] Starting sync for account ${config.accountId}`);
      const result = await syncAnnyForAccount(config.accountId);
      results.push({
        accountId: config.accountId,
        ok: true,
        created: result.created,
        updated: result.updated,
      });
      console.log(`[cron anny-sync] Account ${config.accountId}: created=${result.created} updated=${result.updated} errors=${result.errors}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron anny-sync] Account ${config.accountId} failed:`, msg);
      results.push({
        accountId: config.accountId,
        ok: false,
        error: msg,
      });
    }
  }

  console.log(`[cron anny-sync] Done: ${results.filter((r) => r.ok).length}/${results.length} ok`);
  return NextResponse.json({ synced: results.length, results });
}
