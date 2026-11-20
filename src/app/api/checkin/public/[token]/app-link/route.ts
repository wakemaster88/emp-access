import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { publicRateLimit } from "@/lib/rate-limit";
import { RiderError } from "@/lib/customers";
import { linkAboToApp, readAppCode } from "@/lib/rider-kasse-link";

const schema = z.object({
  code: z.string().trim().min(10).max(80),
  ticketId: z.number().int().positive(),
  role: z.enum(["self", "child"]),
});

/**
 * POST: Abo mit der Kunden-App verknüpfen (Shop-Monitor). Das Personal hat
 * die Abo-Karte und den App-Code gescannt und gewählt, ob die Person der App
 * selbst fährt oder ein Kind. Body: `{ code, ticketId, role }`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicRateLimit(token, "checkin-app-link", { limit: 30, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  const { code, ticketId, role } = parsed.data;

  const app = readAppCode(code);
  if (!app || "invalid" in app) {
    return NextResponse.json({ error: "App-Code abgelaufen oder ungültig. Bitte in der App neu anzeigen lassen." }, { status: 400 });
  }

  try {
    const message = await linkAboToApp(monitor.accountId, ticketId, app.profileId, role);
    console.log(`[checkin] monitor=${monitor.id} Abo ${ticketId} mit App ${app.profileId} verknüpft (${role})`);
    return NextResponse.json({ ok: true, message });
  } catch (err) {
    if (err instanceof RiderError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
