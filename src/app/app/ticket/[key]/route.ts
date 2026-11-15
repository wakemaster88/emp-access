import { NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { claimDayTicket, findDayTicketById, verifyTicketClaimKey } from "@/lib/day-guest";
import { riderAppPath } from "@/lib/rider-app";
import { currentRiderProfileId } from "@/lib/rider-auth";

export const dynamic = "force-dynamic";

/**
 * Kassen-Link zu einem Tagesticket (QR-Code am Check-in). Ordnet das Ticket
 * dem Gast zu und führt in die App: wer auf dem Gerät schon angemeldet ist,
 * sammelt weiter in seinem Profil, alle anderen richten sich neu ein.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const home = new URL("/app", request.url);
  if (publicRateLimit(ip, "rider-ticket-link", { limit: 20, windowMs: 10 * 60_000 })) return NextResponse.redirect(home);

  const ticketId = verifyTicketClaimKey((await params).key);
  const ticket = ticketId != null ? await findDayTicketById(ticketId) : null;
  const token = ticket ? await claimDayTicket(ticket, await currentRiderProfileId()) : null;
  return NextResponse.redirect(token ? new URL(riderAppPath(token), request.url) : home);
}
