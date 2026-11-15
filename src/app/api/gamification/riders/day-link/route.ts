import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gamiAdminSession } from "@/lib/gamification-session";
import { findDayTicketByCode, ticketClaimKey } from "@/lib/day-guest";

const schema = z.object({ code: z.string().trim().min(3).max(200) });

/**
 * POST: App-Link zu einem Tagesticket für die Kasse. Der Gast scannt ihn als
 * QR-Code; erst dabei wird das Ticket einem Profil zugeordnet.
 */
export async function POST(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bitte einen Ticket-Code eingeben." }, { status: 400 });

  const ticket = await findDayTicketByCode(parsed.data.code, session.accountId);
  if (!ticket) {
    return NextResponse.json(
      { error: "Kein passendes Tagesticket gefunden. Armband und Karte gelten nur am Tag des Besuchs, und das Ticket muss in den Einstellungen mitzählen." },
      { status: 404 },
    );
  }
  return NextResponse.json({ path: `/app/ticket/${ticketClaimKey(ticket.id)}`, claimed: ticket.riderProfileId != null });
}
