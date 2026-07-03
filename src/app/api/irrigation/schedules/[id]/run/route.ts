import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { startScheduleRun, stopScheduleRun } from "@/lib/irrigation";

/**
 * Manueller Start/Stopp eines Bewaesserungs-Zeitplans.
 * Body: { action: "start" | "stop", force?: boolean }
 *  - start: Smart-Checks (Regen/Feuchte) anwenden, dann Sequenz-Plan starten
 *    (Ventile nacheinander, Pumpe schaltet mit) bzw. Einzel-Ventil oeffnen.
 *    Mit force=true werden die Smart-Checks uebergangen (Trotzdem starten).
 *  - stop:  alle Ventile der Sequenz + Pumpe schliessen, Plan verwerfen.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const scheduleId = Number(id);
  if (isNaN(scheduleId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as { action?: string; force?: boolean };
  const action = body.action === "stop" ? "stop" : "start";

  const accountId = session.accountId!;
  const result =
    action === "stop"
      ? await stopScheduleRun(scheduleId, accountId)
      : await startScheduleRun(scheduleId, accountId, { force: body.force === true });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Aktion fehlgeschlagen" }, { status: 502 });
  }
  return NextResponse.json(result);
}
