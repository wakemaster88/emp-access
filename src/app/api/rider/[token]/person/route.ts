import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { publicRateLimit } from "@/lib/rate-limit";
import { riderApiManage } from "@/lib/rider-auth";
import { parsePersonInput, PHOTO_MAX_CHARS } from "@/lib/rider-person";

const schema = z.object({
  firstName: z.string().max(200).optional(),
  lastName: z.string().max(200).optional(),
  birthDate: z.string().max(20).nullable().optional(),
  photo: z.string().max(PHOTO_MAX_CHARS + 100).nullable().optional(),
});

/**
 * PATCH: Vorname, Nachname, Geburtsdatum und Profilbild der Person ändern.
 * Selbst oder Eltern für ihr Kind; der Partner sieht nur.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicRateLimit(token, "rider-person", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const ctx = await riderApiManage(token);
  if ("error" in ctx) return ctx.error;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  const result = parsePersonInput(parsed.data);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  await prisma.riderProfile.update({ where: { id: ctx.profile.id }, data: result.data });
  return NextResponse.json({ ok: true });
}
