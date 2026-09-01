import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { collectServiceStatus } from "@/lib/service-status";

export const dynamic = "force-dynamic";

/** GET: Live-Status der lokalen Dienste für die Kontrollzentrum-Kachel. */
export async function GET() {
  const config = await loadConfig();
  const payload = await collectServiceStatus(config);
  return NextResponse.json(payload);
}
