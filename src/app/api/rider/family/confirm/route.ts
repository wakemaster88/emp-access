import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publicRateLimit } from "@/lib/rate-limit";
import { FamilyError } from "@/lib/rider-family";
import { confirmFamilyChildren } from "@/lib/rider-family-link";

const schema = z.object({
  key: z.string().min(10).max(200),
  personIds: z.array(z.number().int().positive()).min(1).max(10),
});

/**
 * POST: Link aus der Mail „Familie in der App bestätigen“. Der Link allein
 * reicht: er ging an die Adresse des Kindes. Die gewählten Personen kommen
 * als verwaltete Mitglieder in die Familie der Einladenden.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = publicRateLimit(ip, "rider-family-confirm", { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  try {
    const added = await confirmFamilyChildren(parsed.data.key, parsed.data.personIds);
    return NextResponse.json({ ok: true, added });
  } catch (e) {
    if (e instanceof FamilyError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
