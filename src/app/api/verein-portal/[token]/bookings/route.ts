import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createVereinBooking, loadPortalVerein } from "@/lib/verein-portal";
import { publicRateLimit } from "@/lib/rate-limit";

export const maxDuration = 30;

const bodySchema = z.object({
  serviceId: z.coerce.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slotStart: z.string().regex(/^\d{2}:\d{2}$/),
  bookedBy: z.string().trim().min(1, "Bitte gebt euren Namen an.").max(120),
  bookedFor: z.string().trim().min(1, "Bitte gebt an, für wen ihr bucht.").max(200),
  note: z.string().trim().max(500).optional().nullable(),
  inclusive: z.boolean().optional().default(false),
});

/**
 * Buchen von Hand: ein Slot je Klick und Dialog. Die Grenze bremst Schleifen,
 * nicht den Verein (mehrere Mitglieder teilen sich den Link).
 */
const VEREIN_BOOKING_LIMIT = { limit: 30, windowMs: 60_000 } as const;

/** Bucht einen Slot fuer den Verein. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicRateLimit(token, "verein-portal-booking", VEREIN_BOOKING_LIMIT);
  if (limited) return limited;
  const verein = await loadPortalVerein(token);
  if (!verein) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const nameMissing = parsed.error.issues.some((i) => i.path[0] === "bookedBy");
    const forMissing = parsed.error.issues.some((i) => i.path[0] === "bookedFor");
    const error = nameMissing ? "Bitte gebt euren Namen an." : forMissing ? "Bitte gebt an, für wen ihr bucht." : "Ungültige Angaben";
    return NextResponse.json({ error }, { status: 400 });
  }

  const result = await createVereinBooking(verein, {
    serviceId: parsed.data.serviceId,
    date: parsed.data.date,
    slotStart: parsed.data.slotStart,
    bookedBy: parsed.data.bookedBy || null,
    bookedFor: parsed.data.bookedFor || null,
    note: parsed.data.note || null,
    inclusive: parsed.data.inclusive,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, bookingId: result.bookingId }, { status: 201 });
}
