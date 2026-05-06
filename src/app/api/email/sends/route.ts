import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Liefert eine paginierte Historie aller Mails, die das System fuer den
 * Account ausgeliefert (oder zu liefern versucht) hat – inkl. Cron-Sends,
 * manuell ausgeloester Sends und Test-Vorschauen.
 *
 * Query-Parameter:
 *  - limit  (1..200, default 50)
 *  - cursor (numerische `EmailSend.id`, blaettert Richtung aelter)
 *  - ruleId (optional: nur Sends einer bestimmten Regel)
 *  - status ("SENT" | "FAILED" | "TEST", optional)
 *  - q      (Volltext, sucht in to/subject/Empfaenger-Namen)
 */
export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT));
  const cursorRaw = url.searchParams.get("cursor");
  const cursor = cursorRaw ? Number(cursorRaw) : null;
  const ruleIdRaw = url.searchParams.get("ruleId");
  const ruleId = ruleIdRaw ? Number(ruleIdRaw) : null;
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q")?.trim() || null;

  const where: Record<string, unknown> = { accountId: accountId! };
  if (ruleId && Number.isFinite(ruleId)) where.ruleId = ruleId;
  if (status && ["SENT", "FAILED", "TEST"].includes(status)) where.status = status;
  if (q) {
    where.OR = [
      { to: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
      { ticket: { firstName: { contains: q, mode: "insensitive" } } },
      { ticket: { lastName: { contains: q, mode: "insensitive" } } },
      { ticket: { name: { contains: q, mode: "insensitive" } } },
    ];
  }
  if (cursor && Number.isFinite(cursor)) {
    where.id = { lt: cursor };
  }

  // +1 um zu erkennen, ob es weitere Seiten gibt.
  const rows = await db.emailSend.findMany({
    where,
    orderBy: { id: "desc" },
    take: limit + 1,
    include: {
      rule: { select: { id: true, name: true, trigger: true } },
      ticket: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          name: true,
          email: true,
          ticketTypeName: true,
        },
      },
      voucher: { select: { id: true, code: true } },
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  return NextResponse.json({
    sends: page.map((s) => ({
      id: s.id,
      to: s.to,
      subject: s.subject,
      status: s.status,
      errorMessage: s.errorMessage,
      sentAt: s.sentAt.toISOString(),
      rule: s.rule
        ? { id: s.rule.id, name: s.rule.name, trigger: s.rule.trigger }
        : null,
      ticket: s.ticket
        ? {
            id: s.ticket.id,
            firstName: s.ticket.firstName,
            lastName: s.ticket.lastName,
            name: s.ticket.name,
            email: s.ticket.email,
            ticketTypeName: s.ticket.ticketTypeName,
          }
        : null,
      voucher: s.voucher ? { id: s.voucher.id, code: s.voucher.code } : null,
    })),
    nextCursor,
    hasMore,
  });
}
