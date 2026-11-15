import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gamiAdminSession } from "@/lib/gamification-session";
import { dayTicketEmailChanged, findDayTicketByCode, normalizeEmail } from "@/lib/day-guest";
import { loadGamiConfig } from "@/lib/gamification-service";
import { berlinYmd } from "@/lib/berlin-day";

const addSchema = z.object({ code: z.string().trim().min(3).max(200), email: z.string().trim().max(180) });
const changeSchema = z.object({ from: z.string().trim().max(180), to: z.string().trim().max(180).nullable() });

const BAD_MAIL = "Bitte eine gültige E-Mail-Adresse eingeben.";

/** POST: E-Mail-Adresse zu einem Tagesticket eintragen (Code scannen oder tippen). */
export async function POST(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bitte Ticket-Code und E-Mail-Adresse eingeben." }, { status: 400 });
  const email = normalizeEmail(parsed.data.email);
  if (!email) return NextResponse.json({ error: BAD_MAIL }, { status: 400 });

  const ticket = await findDayTicketByCode(parsed.data.code, accountId);
  if (!ticket) {
    return NextResponse.json(
      { error: "Kein passendes Tagesticket gefunden. Armband und Karte gelten nur am Tag des Besuchs, und das Ticket muss in den Einstellungen mitzählen." },
      { status: 404 },
    );
  }
  const before = await db.ticket.findFirst({ where: { id: ticket.id, accountId }, select: { id: true, email: true } });
  await db.ticket.update({ where: { id: ticket.id }, data: { email, version: { increment: 1 } } });
  if (before) await dayTicketEmailChanged(accountId, [before], email).catch(() => undefined);
  return NextResponse.json({ ok: true });
}

/** PUT: Adresse an allen Tagestickets dieser Saison ändern; `to: null` entfernt sie. */
export async function PUT(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = changeSchema.safeParse(await request.json().catch(() => null));
  const from = parsed.success ? normalizeEmail(parsed.data.from) : null;
  if (!parsed.success || !from) return NextResponse.json({ error: BAD_MAIL }, { status: 400 });
  const to = parsed.data.to ? normalizeEmail(parsed.data.to) : null;
  if (parsed.data.to && !to) return NextResponse.json({ error: BAD_MAIL }, { status: 400 });

  const config = await loadGamiConfig(db, accountId);
  const year = berlinYmd(new Date()).slice(0, 4);
  const tickets = await db.ticket.findMany({
    where: { accountId, subscriptionId: null, serviceId: { in: config.dayServiceIds }, email: { equals: from, mode: "insensitive" } },
    select: { id: true, email: true, startDate: true, createdAt: true },
    take: 1000,
  });
  const season = tickets.filter((t) => berlinYmd(t.startDate ?? t.createdAt).startsWith(year));
  const ids = season.map((t) => t.id);
  if (ids.length === 0) return NextResponse.json({ error: "Zu dieser Adresse gibt es kein Tagesticket aus dieser Saison." }, { status: 404 });

  await db.ticket.updateMany({ where: { accountId, id: { in: ids } }, data: { email: to, version: { increment: 1 } } });
  await dayTicketEmailChanged(accountId, season, to).catch(() => undefined);
  return NextResponse.json({ ok: true, changed: ids.length });
}
