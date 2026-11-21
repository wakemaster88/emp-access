import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { loadRidePassForStaff } from "@/lib/ride-pass-staff";

/**
 * Ride Pass einer Person für das Personal (Abos › Kundenkonten): Statistik,
 * Saisonrückblick, Awards, Challenges und Gutscheine wie in der Kunden-App.
 * Nur lesen; vergibt und merkt nichts.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { accountId } = session;
  if (!accountId) return NextResponse.json({ error: "Nur innerhalb eines Kontos möglich." }, { status: 403 });

  const { id } = await params;
  const personId = Number(id);
  if (!Number.isInteger(personId) || personId <= 0) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const view = await loadRidePassForStaff(accountId, personId);
  if (!view) return NextResponse.json({ error: "Person nicht gefunden." }, { status: 404 });
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}
