import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { publicRateLimit } from "@/lib/rate-limit";
import { buildScanCodeVariants } from "@/lib/scan-code-variants";
import { sameBirthDate } from "@/lib/gamification";
import { ensureRiderProfile, riderAppPath } from "@/lib/rider-app";

const schema = z.object({
  code: z.string().trim().min(3).max(100),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const FAIL = "Karte und Geburtsdatum passen nicht zusammen. Frag an der Kasse nach deinem persönlichen Link.";

/**
 * Anmeldung an der Kunden-App: Kartennummer des Abos plus Geburtsdatum. Passt
 * beides zu einem Abo-Ticket, gibt es den persönlichen Link zurück. Bewusst
 * dieselbe Antwort für „Karte unbekannt“ und „Geburtsdatum falsch“.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = publicRateLimit(ip, "rider-login", { limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: FAIL }, { status: 400 });

  const variants = buildScanCodeVariants(parsed.data.code);
  const tickets = await prisma.ticket.findMany({
    where: {
      subscriptionId: { not: null },
      birthDate: { not: null },
      status: { in: ["VALID", "REDEEMED", "PAUSED"] },
      OR: variants.flatMap((c) => [{ rfidCode: c }, { barcode: c }, { qrCode: c }]),
    },
    select: { id: true, accountId: true, birthDate: true },
    take: 20,
  });
  const match = tickets.find((t) => sameBirthDate(t.birthDate, parsed.data.birthDate));
  if (!match) return NextResponse.json({ error: FAIL }, { status: 401 });

  const config = await prisma.gamificationConfig.findUnique({ where: { accountId: match.accountId } });
  if (!config?.enabled) {
    return NextResponse.json({ error: "Die App ist für dein Abo noch nicht freigeschaltet." }, { status: 403 });
  }

  const profile = await ensureRiderProfile(match.accountId, match.id);
  if (!profile) return NextResponse.json({ error: FAIL }, { status: 401 });
  return NextResponse.json({ url: riderAppPath(profile.token) });
}
