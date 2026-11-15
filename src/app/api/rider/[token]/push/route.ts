import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { publicRateLimit } from "@/lib/rate-limit";
import { riderApiSession } from "@/lib/rider-auth";
import { riderPushSubscriptionSchema, saveRiderPush, sendPushToRider } from "@/lib/rider-push";
import { riderAppPath } from "@/lib/rider-app";
import { isWebPushConfigured } from "@/lib/web-push";

/**
 * Push-Benachrichtigungen der Kunden-App, nur für die angemeldete Person:
 *   GET    → eingerichtet? Schlüssel, und ob dieses Gerät angemeldet ist
 *   POST   → { subscription } Gerät anmelden, schickt eine Bestätigung
 *   DELETE → { endpoint } Gerät abmelden
 */
async function resolve(params: Promise<{ token: string }>) {
  const { token } = await params;
  const limited = publicRateLimit(token, "rider-push", { limit: 30, windowMs: 60_000 });
  if (limited) return { error: limited };
  const ctx = await riderApiSession(token);
  return "error" in ctx ? ctx : { ...ctx, token };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ctx = await resolve(params);
  if ("error" in ctx) return ctx.error;
  const endpoint = request.nextUrl.searchParams.get("endpoint");
  const existing = endpoint
    ? await prisma.riderPushSubscription.findFirst({
        where: { endpoint, profileId: ctx.profile.id, accountId: ctx.profile.accountId },
        select: { id: true },
      })
    : null;
  return NextResponse.json({
    configured: isWebPushConfigured(),
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
    subscribed: !!existing,
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ctx = await resolve(params);
  if ("error" in ctx) return ctx.error;
  if (!isWebPushConfigured()) {
    return NextResponse.json({ error: "Benachrichtigungen sind hier noch nicht eingerichtet." }, { status: 503 });
  }
  const parsed = z.object({ subscription: riderPushSubscriptionSchema }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });

  await saveRiderPush(ctx.profile.id, ctx.profile.accountId, parsed.data.subscription);
  await sendPushToRider(ctx.profile.id, ctx.profile.accountId, {
    title: "Benachrichtigungen sind an",
    body: "Du erfährst hier, wenn ein neuer Gutschein auf dich wartet.",
    url: riderAppPath(ctx.token),
    tag: "rider-push-on",
  }).catch(() => 0);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ctx = await resolve(params);
  if ("error" in ctx) return ctx.error;
  const parsed = z.object({ endpoint: z.string().max(2000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  await prisma.riderPushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, profileId: ctx.profile.id, accountId: ctx.profile.accountId },
  });
  return NextResponse.json({ ok: true });
}
