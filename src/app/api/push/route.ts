import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { isWebPushConfigured, sendPushToAccount } from "@/lib/web-push";

/**
 * Web-Push-Verwaltung fuer das Dashboard:
 *   GET    → Konfigurations-Status + ob der aktuelle Browser abonniert ist
 *   POST   → { action: "subscribe", subscription } | { action: "test" }
 *   DELETE → { endpoint } – Abo dieses Browsers entfernen
 */

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const endpoint = request.nextUrl.searchParams.get("endpoint");
  let subscribed = false;
  if (endpoint) {
    const existing = await session.db.pushSubscription.findFirst({
      where: { accountId: session.accountId!, endpoint },
      select: { id: true },
    });
    subscribed = !!existing;
  }

  const count = await session.db.pushSubscription.count({
    where: { accountId: session.accountId! },
  });

  return NextResponse.json({
    configured: isWebPushConfigured(),
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
    subscribed,
    deviceCount: count,
  });
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  if (!isWebPushConfigured()) {
    return NextResponse.json(
      {
        error: "Web-Push ist nicht konfiguriert",
        hint: "NEXT_PUBLIC_VAPID_PUBLIC_KEY und VAPID_PRIVATE_KEY als Env-Variablen setzen (npx web-push generate-vapid-keys).",
      },
      { status: 503 },
    );
  }

  const body = await request.json();

  if (body.action === "subscribe") {
    const sub = body.subscription as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    } | undefined;

    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return NextResponse.json({ error: "Ungültige Subscription" }, { status: 400 });
    }

    const data = {
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: request.headers.get("user-agent")?.slice(0, 255) ?? null,
      adminId: Number(session.session.user.id) || null,
      accountId: session.accountId!,
    };

    // Globaler Client statt tenantClient: derselbe Browser-Endpoint kann von
    // einem frueheren Login unter einem anderen Account existieren – der
    // Upsert zieht das Abo dann inkl. accountId auf den aktuellen Account um.
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { endpoint: sub.endpoint, ...data },
      update: data,
    });

    return NextResponse.json({ ok: true });
  }

  if (body.action === "test") {
    const result = await sendPushToAccount(session.accountId!, {
      title: "EMP Access – Testbenachrichtigung",
      body: "Push-Benachrichtigungen funktionieren auf diesem Gerät.",
      url: "/devices",
      tag: "test",
    });
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json().catch(() => ({}));
  const endpoint = body.endpoint as string | undefined;
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint erforderlich" }, { status: 400 });
  }

  await session.db.pushSubscription.deleteMany({
    where: { accountId: session.accountId!, endpoint },
  });

  return NextResponse.json({ ok: true });
}
