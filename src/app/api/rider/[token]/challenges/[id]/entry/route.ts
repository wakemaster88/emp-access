import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { berlinYmd } from "@/lib/berlin-day";
import { publicRateLimit } from "@/lib/rate-limit";
import { riderApiManage } from "@/lib/rider-auth";
import { checkChallengePhoto } from "@/lib/profile-photo-check";
import { PHOTO_CHECKS_EXHAUSTED, takePhotoCheck } from "@/lib/photo-check-limit";
import { removeEntry, saveEntry } from "@/lib/challenge-voting";
import { CHALLENGE_PHOTO_MAX_CHARS } from "@/lib/challenge-voting-rules";

const schema = z.object({ photo: z.string().min(100).max(CHALLENGE_PHOTO_MAX_CHARS) });

function challengeId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * POST: Foto zu einer Foto-Challenge hochladen (ersetzt ein früheres). Selbst
 * oder Eltern für ihr Kind. Vorher prüft die KI, ob das Foto passt.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id: rawId } = await params;
  const limited = publicRateLimit(token, "rider-challenge-entry", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  const ctx = await riderApiManage(token);
  if ("error" in ctx) return ctx.error;
  const id = challengeId(rawId);
  if (id == null) return NextResponse.json({ error: "Ungültige Challenge" }, { status: 400 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Das Foto ist zu groß oder fehlt." }, { status: 400 });

  // Ein Gewinn hängt an einem Ticket: mitmachen kann, wer schon ein Ticket hat.
  const tickets = await prisma.ticket.count({ where: { accountId: ctx.profile.accountId, riderProfileId: ctx.profile.id } });
  if (tickets === 0) {
    return NextResponse.json({ error: "Mitmachen kannst du, sobald du ein Abo oder Ticket hast." }, { status: 409 });
  }

  if (!(await takePhotoCheck(ctx.profile.id))) return NextResponse.json({ error: PHOTO_CHECKS_EXHAUSTED }, { status: 429 });
  const check = await checkChallengePhoto(parsed.data.photo);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 422 });

  const result = await saveEntry(ctx.profile.accountId, id, ctx.profile.id, parsed.data.photo, berlinYmd(new Date()));
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, id: result.id });
}

/** DELETE: eigenes Foto zurückziehen. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id: rawId } = await params;
  const limited = publicRateLimit(token, "rider-challenge-entry", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  const ctx = await riderApiManage(token);
  if ("error" in ctx) return ctx.error;
  const id = challengeId(rawId);
  if (id == null) return NextResponse.json({ error: "Ungültige Challenge" }, { status: 400 });
  const result = await removeEntry(ctx.profile.accountId, id, ctx.profile.id, berlinYmd(new Date()));
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
