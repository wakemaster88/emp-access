import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createVereinRequest, loadPortalVerein } from "@/lib/verein-portal";

const bodySchema = z.object({
  serviceId: z.coerce.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  bookedBy: z.string().trim().min(1, "Bitte gebt euren Namen an.").max(120),
  note: z.string().trim().max(500).optional().nullable(),
});

/** Wunschzeit anfragen: wartet auf Freigabe im Backoffice. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verein = await loadPortalVerein(token);
  if (!verein) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const nameMissing = parsed.error.issues.some((i) => i.path[0] === "bookedBy");
    return NextResponse.json({ error: nameMissing ? "Bitte gebt euren Namen an." : "Ungültige Angaben" }, { status: 400 });
  }
  const result = await createVereinRequest(verein, {
    ...parsed.data,
    bookedBy: parsed.data.bookedBy || null,
    note: parsed.data.note || null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, requestId: result.bookingId }, { status: 201 });
}
