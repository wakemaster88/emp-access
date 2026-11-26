import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-token-auth";
import { buildHubRulePlan, recordHubRuleRuns } from "@/lib/room-rules";
import { loadRuleVersion } from "@/lib/rule-version";

/**
 * GET (Hub): Regel-Plan fuer den Notbetrieb (naechste 48 h, Bedingungen
 * vorab ausgewertet). Siehe `buildHubRulePlan`. `ruleVersion` ist die
 * Version, zu der der Plan passt (src/lib/rule-version.ts).
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const hours = Math.min(72, Math.max(1, Number(request.nextUrl.searchParams.get("hours")) || 48));
  const from = new Date();
  // Version vor dem Plan: Aendert sich dazwischen etwas, enthaelt der Plan es
  // schon, und das naechste Lebenszeichen holt ihn hoechstens einmal mehr.
  const ruleVersion = await loadRuleVersion(auth.db, auth.account.id, from).catch(() => null);
  const rules = await buildHubRulePlan(auth.account.id, from, hours);
  return NextResponse.json({
    generatedAt: from.toISOString(),
    validUntil: new Date(from.getTime() + hours * 3_600_000).toISOString(),
    ...(ruleVersion ? { ruleVersion } : {}),
    rules,
  });
}

/**
 * POST (Hub): Regel-Laeufe des Hubs nachtragen (Notbetrieb und Bewegungs-
 * Regeln, die er direkt ausgefuehrt hat).
 * Body: { runs: [{ ruleId, at, fireAt?, eventAt?, finishedAt?, triggerKind, success, details, errorMessage, handedOver? }] }
 * `fireAt` ist der Termin laut Plan (Zeit-Regeln), `eventAt` die Zeit des
 * Kamera-Ereignisses; aeltere Hubs lassen beide weg. `handedOver`: direkter
 * Lauf, den die Cloud selbst ausfuehrt (Frist abgelaufen oder nicht ganz
 * gelungen); er zaehlt nicht fuer die Abklingzeit. Ein Lauf, der schon
 * eingetragen ist, zaehlt als gespeichert und wird nicht doppelt angelegt.
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
      fireAt: typeof r.fireAt === "string" && !isNaN(Date.parse(r.fireAt)) ? new Date(r.fireAt) : null,
      eventAt: typeof r.eventAt === "string" && !isNaN(Date.parse(r.eventAt)) ? new Date(r.eventAt) : null,
      finishedAt: typeof r.finishedAt === "string" && !isNaN(Date.parse(r.finishedAt)) ? new Date(r.finishedAt) : null,
      triggerKind: String(r.triggerKind ?? "hub").slice(0, 40),
      success: r.success === true,
      details: Array.isArray(r.details) ? r.details : [],
      errorMessage: typeof r.errorMessage === "string" ? r.errorMessage.slice(0, 1000) : null,
      handedOver: r.handedOver === true,
    }))
    .filter((r: { ruleId: number; at: Date }) => Number.isInteger(r.ruleId) && !isNaN(r.at.getTime()));
  const saved = await recordHubRuleRuns(auth.account.id, runs);
  return NextResponse.json({ ok: true, saved });
}
