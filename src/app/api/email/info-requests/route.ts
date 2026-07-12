import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { getSessionWithDb } from "@/lib/api-auth";
import { sendEmail } from "@/lib/email-sender";
import { wrapEmailHtml } from "@/lib/email-templates";
import {
  buildInfoRequestInnerHtml,
  formatPlaceRange,
  groupPlaceTickets,
} from "@/lib/info-request";

/**
 * Info-Anfragen (Dashboard):
 *   GET  – Templates + Versand-Historie + optional Empfaenger-Vorschau
 *          fuer einen Service (?serviceId=&weekStart=)
 *   POST – Versand an alle (gefilterten) Empfaenger des Service.
 *
 * Ein "Empfaenger" ist eine Email-Adresse; alle Kursplaetze dieser Adresse
 * werden in EINER Mail gebuendelt (ein Formular-Link deckt alle Plaetze ab).
 */

/** Sequenzieller Mail-Versand an bis zu ~150 Empfaenger braucht Zeit;
 *  das globale 10s-Limit aus vercel.json wuerde den Versand mittendrin
 *  abbrechen (passiert am 12.07. nach 24 von 110 Empfaengern). */
export const maxDuration = 300;

interface RecipientTicket {
  id: number;
  uuid: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  startDate: Date | null;
  endDate: Date | null;
  guestInfo: unknown;
}

interface Recipient {
  email: string;
  firstName: string | null;
  lastName: string | null;
  /** Alle Tickets der abgedeckten Plaetze (Woche + Tage), flach. */
  ticketIds: number[];
  places: { range: string; start: string | null; ticketIds: number[]; answered: boolean }[];
}

type SessionDb = Extract<Awaited<ReturnType<typeof getSessionWithDb>>, { db: unknown }>["db"];

async function collectRecipients(
  db: SessionDb,
  accountId: number,
  serviceId: number,
  weekStart: string | null,
): Promise<Recipient[]> {
  const tickets: RecipientTicket[] = await db.ticket.findMany({
    where: {
      accountId,
      serviceId,
      status: "VALID",
      email: { not: null },
    },
    select: {
      id: true,
      uuid: true,
      email: true,
      firstName: true,
      lastName: true,
      startDate: true,
      endDate: true,
      guestInfo: true,
    },
  });

  // Woche-Fenster (Berlin-naiv: der weekStart kommt als YYYY-MM-DD, die
  // Ticket-Starts liegen um 10:00 Berlin -> ein Fenster mit +/-2h Toleranz
  // ist hier unnoetig, das Datum reicht).
  let windowStart: Date | null = null;
  let windowEnd: Date | null = null;
  if (weekStart) {
    windowStart = new Date(`${weekStart}T00:00:00+02:00`);
    windowEnd = new Date(windowStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  const byEmail = new Map<string, RecipientTicket[]>();
  for (const t of tickets) {
    const key = t.email!.trim().toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key)!.push(t);
  }

  const recipients: Recipient[] = [];
  for (const [, list] of byEmail) {
    const groups = groupPlaceTickets(list);
    const matching = groups.filter((g) => {
      if (!windowStart || !windowEnd) return true;
      const primary = g[0];
      return (
        primary.startDate != null &&
        primary.startDate >= windowStart &&
        primary.startDate < windowEnd
      );
    });
    if (matching.length === 0) continue;
    const first = list[0];
    recipients.push({
      email: first.email!.trim(),
      firstName: first.firstName,
      lastName: first.lastName,
      ticketIds: matching.flatMap((g) => g.map((t) => t.id)),
      places: matching.map((g) => ({
        range: formatPlaceRange(g[0]),
        start: g[0].startDate?.toISOString() ?? null,
        ticketIds: g.map((t) => t.id),
        answered: g[0].guestInfo != null && Object.keys(g[0].guestInfo as object).length > 0,
      })),
    });
  }
  recipients.sort((a, b) => a.email.localeCompare(b.email));
  return recipients;
}

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const templates = await db.infoFormTemplate.findMany({
    where: { accountId: accountId! },
    orderBy: { createdAt: "asc" },
  });

  const recentRequests = await db.infoRequest.findMany({
    where: { accountId: accountId! },
    orderBy: { sentAt: "desc" },
    take: 30,
    select: {
      id: true,
      email: true,
      status: true,
      sentAt: true,
      completedAt: true,
      ticketIds: true,
      template: { select: { id: true, name: true } },
    },
  });

  const serviceIdRaw = request.nextUrl.searchParams.get("serviceId");
  const weekStart = request.nextUrl.searchParams.get("weekStart");
  let preview: { recipients: Recipient[]; totalPlaces: number } | null = null;
  if (serviceIdRaw) {
    const serviceId = Number(serviceIdRaw);
    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return NextResponse.json({ error: "Ungültige serviceId" }, { status: 400 });
    }
    const recipients = await collectRecipients(db, accountId!, serviceId, weekStart || null);
    preview = {
      recipients,
      totalPlaces: recipients.reduce((n, r) => n + r.places.length, 0),
    };
  }

  return NextResponse.json({
    templates,
    recentRequests: recentRequests.map((r) => ({
      ...r,
      ticketCount: Array.isArray(r.ticketIds) ? (r.ticketIds as number[]).length : 0,
      ticketIds: undefined,
    })),
    preview,
  });
}

const sendSchema = z.object({
  templateId: z.coerce.number().int().positive(),
  serviceId: z.coerce.number().int().positive(),
  /** Optional: nur Plaetze mit Start in dieser Woche (Montag als YYYY-MM-DD). */
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** Empfaenger erneut anschreiben, auch wenn schon eine Anfrage existiert. */
  resend: z.boolean().optional(),
  /** Nur an diese Adresse senden (Test / gezielter Einzelversand). */
  emailFilter: z.string().email().optional(),
});

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json().catch(() => ({}));
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { templateId, serviceId, weekStart, resend, emailFilter } = parsed.data;

  const [template, service, emailConfig, account] = await Promise.all([
    db.infoFormTemplate.findFirst({ where: { id: templateId, accountId: accountId! } }),
    db.service.findFirst({ where: { id: serviceId, accountId: accountId! }, select: { name: true } }),
    db.emailConfig.findUnique({ where: { accountId: accountId! } }),
    db.account.findUnique({ where: { id: accountId! }, select: { name: true } }),
  ]);
  if (!template) return NextResponse.json({ error: "Template nicht gefunden" }, { status: 404 });
  if (!service) return NextResponse.json({ error: "Service nicht gefunden" }, { status: 404 });
  if (!emailConfig?.apiKey || !emailConfig.fromEmail || !emailConfig.isActive) {
    return NextResponse.json(
      { error: "Email-Konfiguration unvollständig oder deaktiviert." },
      { status: 400 },
    );
  }

  let recipients = await collectRecipients(db, accountId!, serviceId, weekStart ?? null);
  if (emailFilter) {
    recipients = recipients.filter(
      (r) => r.email.toLowerCase() === emailFilter.toLowerCase(),
    );
  }
  if (recipients.length === 0) {
    return NextResponse.json({ error: "Keine Empfänger gefunden." }, { status: 400 });
  }

  // Bereits angeschriebene Adressen (gleiches Template) ueberspringen,
  // ausser resend=true. FAILED zaehlt nicht als "angeschrieben".
  const existing = await db.infoRequest.findMany({
    where: { accountId: accountId!, templateId, status: { in: ["SENT", "COMPLETED"] } },
    select: { email: true },
  });
  const alreadySent = new Set(existing.map((r) => r.email.toLowerCase()));

  const origin = request.nextUrl.origin;
  const subject = `Kurze Infos für deinen ${service.name} – ${account?.name ?? "EMP Access"}`;

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const recipient of recipients) {
    if (!resend && alreadySent.has(recipient.email.toLowerCase())) {
      skipped++;
      continue;
    }
    // Wenn alle Plaetze schon beantwortet sind, gibt es nichts zu erfragen.
    if (recipient.places.every((p) => p.answered)) {
      skipped++;
      continue;
    }

    const token = randomBytes(24).toString("base64url");
    const infoRequest = await db.infoRequest.create({
      data: {
        accountId: accountId!,
        templateId,
        token,
        email: recipient.email,
        ticketIds: recipient.ticketIds,
        status: "SENT",
      },
    });

    const formUrl = `${origin}/info/${token}`;
    const innerHtml = buildInfoRequestInnerHtml({
      accountName: account?.name ?? "EMP Access",
      serviceName: service.name,
      formUrl,
      placeCount: recipient.places.length,
      firstName: recipient.firstName,
    });
    const html = wrapEmailHtml({
      innerHtml,
      brandColor: emailConfig.brandColor,
      logoUrl: emailConfig.logoUrl,
      websiteUrl: emailConfig.websiteUrl,
      accountName: account?.name,
      preheader: `Bitte kurz ausfüllen: Infos für deinen ${service.name}`,
    });

    const result = await sendEmail({
      config: {
        provider: emailConfig.provider,
        apiKey: emailConfig.apiKey,
        fromEmail: emailConfig.fromEmail,
        fromName: emailConfig.fromName,
        replyTo: emailConfig.replyTo,
      },
      to: recipient.email,
      subject,
      html,
    });

    if (result.ok) {
      sent++;
    } else {
      failed++;
      errors.push(`${recipient.email}: ${result.error ?? "unbekannter Fehler"}`);
      await db.infoRequest.update({
        where: { id: infoRequest.id },
        data: { status: "FAILED" },
      });
    }

    await db.emailSend.create({
      data: {
        accountId: accountId!,
        to: recipient.email,
        subject,
        status: result.ok ? "SENT" : "FAILED",
        errorMessage: result.ok ? null : (result.error?.slice(0, 500) ?? "unbekannter Fehler"),
      },
    });
  }

  return NextResponse.json({ sent, skipped, failed, errors });
}
