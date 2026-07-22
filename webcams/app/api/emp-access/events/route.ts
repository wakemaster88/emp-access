import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import {
  getEmpAccessSnapshot,
  refreshEmpAccessIfDue,
} from "@/lib/emp-access-runtime";

export const dynamic = "force-dynamic";

/**
 * Liefert die letzten emp-access-Ereignisse gruppiert nach Kamera.
 * Triggert bei Bedarf einen Poll (Intervall siehe settings.empAccess.pollIntervalSec).
 */
export async function GET() {
  const cfg = await loadConfig();
  const empOk =
    cfg.settings.empAccess.enabled && !!cfg.settings.empAccess.apiToken?.trim();

  if (empOk) {
    await refreshEmpAccessIfDue();
  }

  const snap = getEmpAccessSnapshot(empOk);
  return NextResponse.json({
    ...snap,
    pollIntervalSec: cfg.settings.empAccess.pollIntervalSec,
  });
}
