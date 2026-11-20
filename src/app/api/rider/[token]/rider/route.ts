import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publicRateLimit } from "@/lib/rate-limit";
import { riderApiSession } from "@/lib/rider-auth";
import { assignRider, RiderError } from "@/lib/customers";
import { kontoRidersFor } from "@/lib/rider-konto";

const schema = z.union([
  z.object({ ticketId: z.number().int().positive(), personId: z.number().int().positive() }),
  z.object({
    ticketId: z.number().int().positive(),
    firstName: z.string().trim().max(80),
    lastName: z.string().trim().max(80),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }),
]);

/**
 * POST: „Neues Abo: Für wen ist es?“ Nur wer sich mit der Adresse des Kontos
 * angemeldet hat, und nur für Abos des Kontos ohne Fahrer. Body
 * `{ ticketId, personId }` oder `{ ticketId, firstName, lastName, birthDate }`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited =
    publicRateLimit(ip, "rider-assign-ip", { limit: 30, windowMs: 10 * 60_000 }) ??
    publicRateLimit(token, "rider-assign", { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const ctx = await riderApiSession(token);
  if ("error" in ctx) return ctx.error;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  const input = parsed.data;

  const konto = await kontoRidersFor(ctx.profile.id);
  if (!konto || !konto.abos.some((a) => a.ticketId === input.ticketId)) {
    return NextResponse.json({ error: "Für dieses Abo ist schon jemand eingetragen." }, { status: 409 });
  }

  try {
    await assignRider(
      ctx.profile.accountId,
      input.ticketId,
      "personId" in input
        ? { personId: input.personId }
        : { firstName: input.firstName, lastName: input.lastName, birthDate: input.birthDate ? new Date(input.birthDate) : null },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RiderError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
