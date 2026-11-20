import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { RiderError, updatePersonData } from "@/lib/customers";

/**
 * Name, Geburtsdatum und „Fährt seit“ einer Person ändern (Abos ›
 * Kundenkonten). Body: `{ firstName?, lastName?, birthDate?, ridingSince? }`,
 * nur übergebene Felder. `ridingSince` ist das erste Jahr an der Anlage und
 * zählt bei den Treue-Awards mit; `null` leert es.
 */
export async function PATCH(
  request: NextRequest,
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

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const field = (v: unknown) => (v === undefined ? undefined : typeof v === "string" ? v : null);
  const firstName = field(body.firstName);
  const lastName = field(body.lastName);
  const birth = field(body.birthDate);
  const since = body.ridingSince;
  if (since !== undefined && since !== null && typeof since !== "number") {
    return NextResponse.json({ error: "Das Jahr bei „Fährt seit“ stimmt nicht." }, { status: 400 });
  }
  if (firstName !== undefined && lastName !== undefined && !firstName?.trim() && !lastName?.trim()) {
    return NextResponse.json({ error: "Bitte Vor- oder Nachnamen eintragen." }, { status: 400 });
  }

  try {
    await updatePersonData(accountId, personId, {
      firstName,
      lastName,
      birthDate: birth === undefined ? undefined : birth ? new Date(birth) : null,
      ridingSince: since,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RiderError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
