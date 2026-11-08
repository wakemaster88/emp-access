import { NextRequest, NextResponse } from "next/server";
import { loadPortalSlots, loadPortalVerein } from "@/lib/verein-portal";
import { isDateBookable } from "@/lib/verein-portal-rules";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Slots eines freigegebenen Service an einem Tag (frei, belegt, eigene Buchung). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verein = await loadPortalVerein(token);
  if (!verein) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const serviceId = Number(request.nextUrl.searchParams.get("serviceId"));
  const date = request.nextUrl.searchParams.get("date") ?? "";
  if (!verein.bookableServices.some((s) => s.serviceId === serviceId)) {
    return NextResponse.json({ error: "Service nicht freigegeben" }, { status: 403 });
  }
  if (!DATE_RE.test(date)) return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
  if (!isDateBookable(date, verein.portalHorizonDays)) {
    return NextResponse.json({ slots: [], note: `Buchbar sind nur die nächsten ${verein.portalHorizonDays} Tage.` });
  }

  const result = await loadPortalSlots(verein, serviceId, date);
  return NextResponse.json(result);
}
