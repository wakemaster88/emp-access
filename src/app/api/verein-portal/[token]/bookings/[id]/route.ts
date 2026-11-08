import { NextRequest, NextResponse } from "next/server";
import { cancelVereinBooking, loadPortalVerein } from "@/lib/verein-portal";

export const maxDuration = 30;

/** Storniert eine eigene Buchung (nur bis zur Storno-Frist). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const verein = await loadPortalVerein(token);
  if (!verein) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const result = await cancelVereinBooking(verein.accountId, bookingId, "VEREIN", { vereinId: verein.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
