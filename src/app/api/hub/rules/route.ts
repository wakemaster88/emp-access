import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { buildHubRulePlan, recordHubRuleRuns } from "@/lib/room-rules";

/**
 * GET (Hub): Regel-Plan fuer den Notbetrieb (naechste 48 h, Bedingungen
 * vorab ausgewertet). Siehe `buildHubRulePlan`.
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const hours = Math.min(72, Math.max(1, Number(request.nextUrl.searchParams.get("hours")) || 48));
  const from = new Date();
  const rules = await buildHubRulePlan(auth.account.id, from, hours);
  return NextResponse.json({
    generatedAt: from.toISOString(),
    validUntil: new Date(from.getTime() + hours * 3_600_000).toISOString(),
    rules,
  });
}

/**
 * POST (Hub): Regel-Laeufe aus dem Notbetrieb nachtragen.
 * Body: { runs: [{ ruleId, at, triggerKind, success, details, errorMessage }] }
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({}));
  const raw = Array.isArray(body.runs) ? body.runs.slice(0, 500) : [];
  const runs = raw
    .map((r: Record<string, unknown>) => ({
      ruleId: Number(r.ruleId),
      at: new Date(String(r.at)),
      triggerKind: String(r.triggerKind ?? "hub").slice(0, 40),
      success: r.success === true,
      details: Array.isArray(r.details) ? r.details : [],
      errorMessage: typeof r.errorMessage === "string" ? r.errorMessage.slice(0, 1000) : null,
    }))
    .filter((r: { ruleId: number; at: Date }) => Number.isInteger(r.ruleId) && !isNaN(r.at.getTime()));
  const saved = await recordHubRuleRuns(auth.account.id, runs);
  return NextResponse.json({ ok: true, saved });
}
