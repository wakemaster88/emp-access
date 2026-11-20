import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { assignRider, RiderError, type RiderInput } from "@/lib/customers";

/**
 * Wer fährt mit diesem Abo? (Abos › „Fahrer offen“)
 * Body: `{ personId }` für eine Person des Kundenkontos oder
 * `{ firstName, lastName, birthDate }` für eine neue Person.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { accountId } = session;
  if (!accountId) return NextResponse.json({ error: "Nur innerhalb eines Kontos möglich." }, { status: 403 });

  const { id } = await params;
  const ticketId = Number(id);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  let input: RiderInput;
  if (body.personId != null) {
    const personId = Number(body.personId);
    if (!Number.isInteger(personId) || personId <= 0) {
      return NextResponse.json({ error: "Ungültige Person" }, { status: 400 });
    }
    input = { personId };
  } else {
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    const birth = str(body.birthDate);
    input = {
      firstName: str(body.firstName),
      lastName: str(body.lastName),
      birthDate: birth ? new Date(birth) : null,
    };
  }

  try {
    const result = await assignRider(accountId, ticketId, input);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RiderError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
