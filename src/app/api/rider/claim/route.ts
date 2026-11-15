import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publicRateLimit } from "@/lib/rate-limit";
import { claimDayTicket, findDayTicketByCode } from "@/lib/day-guest";
import { riderAppPath } from "@/lib/rider-app";
import { currentRiderProfileId } from "@/lib/rider-auth";

const schema = z.object({ code: z.string().trim().min(3).max(200) });

const FAIL = "Dieses Ticket kennen wir nicht. Mit Armband oder Karte geht es nur am Tag des Besuchs, sonst hilft dir die Kasse.";

/**
 * POST: Tagesticket in der App anmelden, per gescanntem oder getipptem Code.
 * Ist auf dem Gerät schon jemand angemeldet, kommt das Ticket zu diesem
 * Profil, sonst entsteht ein neues. Antwort ist der Link in die App.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = publicRateLimit(ip, "rider-claim", { limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: FAIL }, { status: 400 });

  const ticket = await findDayTicketByCode(parsed.data.code);
  if (!ticket) return NextResponse.json({ error: FAIL }, { status: 404 });

  const sessionProfileId = await currentRiderProfileId();
  const token = await claimDayTicket(ticket, sessionProfileId);
  if (!token) return NextResponse.json({ error: FAIL }, { status: 404 });
  return NextResponse.json({ url: riderAppPath(token), added: ticket.riderProfileId == null });
}
