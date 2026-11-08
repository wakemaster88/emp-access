import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { cancelVereinBooking } from "@/lib/verein-portal";

export const maxDuration = 30;

/** Backoffice-Storno einer Vereinsbuchung (ohne Frist, wird nicht abgerechnet). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) return NextResponse.json({ error: "Kein Mandant" }, { status: 403 });
  const { id } = await params;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const result = await cancelVereinBooking(session.accountId, bookingId, "ADMIN");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
