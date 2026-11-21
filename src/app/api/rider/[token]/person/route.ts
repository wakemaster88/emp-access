import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { publicRateLimit } from "@/lib/rate-limit";
import { riderApiManage } from "@/lib/rider-auth";
import { parsePersonInput, PHOTO_MAX_CHARS } from "@/lib/rider-person";
import { checkProfilePhoto } from "@/lib/profile-photo-check";
import { PHOTO_CHECKS_EXHAUSTED, takePhotoCheck } from "@/lib/photo-check-limit";

const schema = z.object({
  firstName: z.string().max(200).optional(),
  lastName: z.string().max(200).optional(),
  birthDate: z.string().max(20).nullable().optional(),
  photo: z.string().max(PHOTO_MAX_CHARS + 100).nullable().optional(),
});

/**
 * PATCH: Vorname, Nachname, Geburtsdatum und Profilbild der Person ändern.
 * Selbst oder Eltern für ihr Kind; der Partner sieht nur. Ein neues Profilbild
 * prüft vorher die KI (`profile-photo-check.ts`).
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

  // Neues Profilbild: die KI prüft, ob darauf eine Person mit erkennbarem Gesicht ist.
  if (typeof result.data.photo === "string") {
    if (!(await takePhotoCheck(ctx.profile.id))) return NextResponse.json({ error: PHOTO_CHECKS_EXHAUSTED }, { status: 429 });
    const check = await checkProfilePhoto(result.data.photo);
    if (!check.ok) return NextResponse.json({ error: check.error, verdict: check.verdict }, { status: 422 });
  }

  await prisma.riderProfile.update({ where: { id: ctx.profile.id }, data: result.data });
  return NextResponse.json({ ok: true });
}
