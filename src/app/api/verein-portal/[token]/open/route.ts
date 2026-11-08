import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadPortalVerein, openPortalAccessPoint } from "@/lib/verein-portal";

export const maxDuration = 20;

const bodySchema = z.object({
  kind: z.enum(["device", "doorbird"]),
  id: z.coerce.number().int().positive(),
});

/** Oeffnet eine freigegebene Tuer/ein Tor, nur im Zugangsfenster einer Buchung. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verein = await loadPortalVerein(token);
  if (!verein) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Angaben" }, { status: 400 });
  const result = await openPortalAccessPoint(verein, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
