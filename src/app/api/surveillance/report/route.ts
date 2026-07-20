import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { buildSurveillanceReport } from "@/lib/surveillance-report";

/** GET (Session): Überwachungsbericht für eine Periode (Default: aktuelle/letzte). */
export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { accountId } = session;

  const periodKey = request.nextUrl.searchParams.get("period");

  const report = await buildSurveillanceReport({
    accountId: accountId!,
    periodKey,
  });

  if ("error" in report) {
    return NextResponse.json({ error: report.error }, { status: report.status });
  }

  return NextResponse.json({
    ...report,
    period: {
      ...report.period,
      start: report.period.start.toISOString(),
      end: report.period.end.toISOString(),
    },
    periods: report.periods.map((p) => ({
      ...p,
      start: p.start.toISOString(),
      end: p.end.toISOString(),
    })),
  });
}
