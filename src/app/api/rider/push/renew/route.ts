import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { publicRateLimit } from "@/lib/rate-limit";
import { riderPushSubscriptionSchema } from "@/lib/rider-push";

const schema = z.object({
  oldEndpoint: z.string().max(2000),
  subscription: riderPushSubscriptionSchema,
});

/**
 * POST: Der Push-Dienst hat das Abo eines Geräts ausgetauscht; der Service
 * Worker meldet das neue. Berechtigung ist die bisherige Adresse des Abos,
 * die nur dieses Gerät und der Server kennen. Unbekannte Adressen ändern nichts.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = publicRateLimit(ip, "rider-push-renew", { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  const { oldEndpoint, subscription } = parsed.data;

  // Gibt es die neue Adresse schon, bleibt alles, wie es ist.
  await prisma.riderPushSubscription
    .updateMany({
      where: { endpoint: oldEndpoint },
      data: { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
    })
    .catch(() => null);
  return NextResponse.json({ ok: true });
}
