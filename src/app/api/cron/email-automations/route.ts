import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processAccountEmailRules } from "@/lib/email-automation";

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
      },
    };
  }
  return { ok: true };
}

/**
 * Stündlicher Cron-Job: laedt alle Accounts mit aktiver EmailConfig und
 * verarbeitet pro Account die aktiven Regeln. Idempotenz uebernimmt das
 * Cooldown-Fenster + 24h-Trigger-Window in `processAccountEmailRules`.
 */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request);
  if (!authResult.ok) {
    console.warn(`[cron email] Auth failed:`, JSON.stringify(authResult.body));
    return NextResponse.json(authResult.body, { status: authResult.status });
  }

  const accounts = await prisma.emailConfig.findMany({
    where: { isActive: true, apiKey: { not: null } },
    select: { accountId: true },
  });

  if (accounts.length === 0) {
    return NextResponse.json({ message: "Keine aktiven Email-Konfigurationen", processed: 0 });
  }

  const results = [];
  let totalSent = 0;
  for (const acc of accounts) {
    try {
      const result = await processAccountEmailRules(acc.accountId);
      totalSent += result.totalSent;
      results.push(result);
      console.log(
        `[cron email] account=${acc.accountId} sent=${result.totalSent} rules=${result.ruleStats.length}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron email] account=${acc.accountId} failed:`, msg);
      results.push({ accountId: acc.accountId, ok: false, ruleStats: [], totalSent: 0, error: msg });
    }
  }

  return NextResponse.json({
    processed: results.length,
    totalSent,
    results,
  });
}
