import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { publicRateLimit } from "@/lib/rate-limit";
import { riderApiManage } from "@/lib/rider-auth";
import { BIRTH_DATE_LOCK_DAYS, BIRTH_DATE_LOCKED_TEXT, birthDateChange, parsePersonInput, PHOTO_MAX_CHARS } from "@/lib/rider-person";
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
 * prüft vorher die KI (`profile-photo-check.ts`). Ein eingetragenes
 * Geburtsdatum lässt sich hier einmal im Jahr ändern, sonst an der Kasse
 * (`birthDateChange`). Jede Änderung an Name oder Geburtsdatum steht im Log
 * (nur welches Feld, nicht der Wert).
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

  const data: typeof result.data & { birthDateChangedAt?: Date } = { ...result.data };
  const changed: string[] = [];
  if (data.firstName !== undefined) {
    const now = new Date();
    const current = await prisma.riderProfile.findUnique({
      where: { id: ctx.profile.id },
      select: { firstName: true, lastName: true, birthDate: true, birthDateChangedAt: true },
    });
    if (!current) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
    const birth = birthDateChange(current.birthDate, data.birthDate ?? null, current.birthDateChangedAt, now);
    if (birth === "blocked") return NextResponse.json({ error: BIRTH_DATE_LOCKED_TEXT }, { status: 409 });
    if (birth === "change") data.birthDateChangedAt = now;
    if (data.firstName !== (current.firstName ?? "")) changed.push("firstName");
    if (data.lastName !== undefined && data.lastName !== (current.lastName ?? "")) changed.push("lastName");
    if (birth !== "same") changed.push("birthDate");
  }

  // Neues Profilbild: die KI prüft, ob darauf eine Person mit erkennbarem Gesicht ist.
  if (typeof result.data.photo === "string") {
    if (!(await takePhotoCheck(ctx.profile.id))) return NextResponse.json({ error: PHOTO_CHECKS_EXHAUSTED }, { status: 429 });
    const check = await checkProfilePhoto(result.data.photo);
    if (!check.ok) return NextResponse.json({ error: check.error, verdict: check.verdict }, { status: 422 });
  }

  if (data.birthDateChangedAt) {
    // Die eine Änderung im Jahr: nur schreiben, wenn sie nicht gerade schon eine andere Anfrage verbraucht hat.
    const cutoff = new Date(data.birthDateChangedAt.getTime() - BIRTH_DATE_LOCK_DAYS * 86_400_000);
    const done = await prisma.riderProfile.updateMany({
      where: { id: ctx.profile.id, OR: [{ birthDateChangedAt: null }, { birthDateChangedAt: { lte: cutoff } }] },
      data,
    });
    if (done.count === 0) return NextResponse.json({ error: BIRTH_DATE_LOCKED_TEXT }, { status: 409 });
  } else {
    await prisma.riderProfile.update({ where: { id: ctx.profile.id }, data });
  }
  if (changed.length > 0) {
    console.info(
      `[rider person] account=${ctx.profile.accountId} profile=${ctx.profile.id} fields=${changed.join(",")} by=${ctx.relation} at=${new Date().toISOString()}`,
    );
  }
  return NextResponse.json({ ok: true });
}
