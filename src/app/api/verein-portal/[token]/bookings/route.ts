import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createVereinBooking, loadPortalVerein } from "@/lib/verein-portal";

export const maxDuration = 30;

const bodySchema = z.object({
  serviceId: z.coerce.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slotStart: z.string().regex(/^\d{2}:\d{2}$/),
  bookedBy: z.string().trim().min(1, "Bitte gebt euren Namen an.").max(120),
  note: z.string().trim().max(500).optional().nullable(),
});

/** Bucht einen Slot fuer den Verein. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
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
    return NextResponse.json({ error: nameMissing ? "Bitte gebt euren Namen an." : "Ungültige Angaben" }, { status: 400 });
  }

  const result = await createVereinBooking(verein, {
    serviceId: parsed.data.serviceId,
    date: parsed.data.date,
    slotStart: parsed.data.slotStart,
    bookedBy: parsed.data.bookedBy || null,
    note: parsed.data.note || null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, bookingId: result.bookingId }, { status: 201 });
}
