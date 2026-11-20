import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { mergeCustomers, RiderError } from "@/lib/customers";

/**
 * Konto `fromId` in dieses Konto übernehmen (Abos › Kundenkonten).
 * Body: `{ fromId }`. Lässt sich nicht zurücknehmen, daher nur für Admins.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  const { accountId } = session;
  if (!accountId) return NextResponse.json({ error: "Nur innerhalb eines Kontos möglich." }, { status: 403 });

  const { id } = await params;
  const intoId = Number(id);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const fromId = Number(body.fromId);
  if (!Number.isInteger(intoId) || intoId <= 0 || !Number.isInteger(fromId) || fromId <= 0) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  try {
    const result = await mergeCustomers(accountId, intoId, fromId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RiderError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
