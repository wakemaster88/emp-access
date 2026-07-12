import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  PARTICIPANT_NAME_LABEL,
  bookingNumberOf,
  formatPlaceRange,
  groupPlaceTickets,
  type InfoFormField,
} from "@/lib/info-request";

/**
 * Oeffentliches Info-Formular (per Token aus der Anfrage-Mail):
 *   GET  – Formular-Definition + Plaetze + bereits gespeicherte Antworten
 *   POST – Antworten speichern (schreibt Ticket.guestInfo aller Tickets
 *          des jeweiligen Platzes: Woche + Tagestickets)
 */

async function loadRequest(token: string) {
  if (!token || token.length < 16) return null;
  const infoRequest = await prisma.infoRequest.findUnique({
    where: { token },
    include: {
      template: true,
      account: { select: { id: true, name: true } },
    },
  });
  if (!infoRequest) return null;

  const ticketIds = Array.isArray(infoRequest.ticketIds)
    ? (infoRequest.ticketIds as number[])
    : [];
  const tickets = await prisma.ticket.findMany({
    where: { id: { in: ticketIds }, accountId: infoRequest.accountId },
    select: {
      id: true,
      uuid: true,
      firstName: true,
      lastName: true,
      startDate: true,
      endDate: true,
      guestInfo: true,
      service: { select: { name: true } },
    },
  });
  return { infoRequest, tickets };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const loaded = await loadRequest(token);
  if (!loaded) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const { infoRequest, tickets } = loaded;

  // Branding (Logo/Farbe/Website) aus der Email-Config des Accounts, damit
  // das Formular optisch zur Website/den Mails passt.
  const emailConfig = await prisma.emailConfig.findUnique({
    where: { accountId: infoRequest.accountId },
    select: { brandColor: true, logoUrl: true, websiteUrl: true },
  });

  const groups = groupPlaceTickets(tickets);
  const places = groups.map((g, i) => {
    const primary = g[0];
    const values = (primary.guestInfo ?? {}) as Record<string, string>;
    return {
      index: i + 1,
      primaryTicketId: primary.id,
      range: formatPlaceRange(primary),
      bookedName: [primary.firstName, primary.lastName].filter(Boolean).join(" ") || null,
      bookingNumber: bookingNumberOf(primary),
      answered: Object.keys(values).length > 0,
      values,
    };
  });

  return NextResponse.json({
    accountName: infoRequest.account.name,
    serviceName: tickets[0]?.service?.name ?? null,
    branding: {
      color: emailConfig?.brandColor ?? null,
      logoUrl: emailConfig?.logoUrl ?? null,
      websiteUrl: emailConfig?.websiteUrl ?? null,
    },
    status: infoRequest.status,
    template: {
      name: infoRequest.template.name,
      introText: infoRequest.template.introText,
      fields: infoRequest.template.fields as unknown as InfoFormField[],
      askParticipantName: infoRequest.template.askParticipantName,
    },
    participantNameLabel: PARTICIPANT_NAME_LABEL,
    places,
  });
}

const submitSchema = z.object({
  answers: z
    .array(
      z.object({
        primaryTicketId: z.number().int().positive(),
        values: z.record(z.string().max(80), z.string().max(160)),
      }),
    )
    .min(1)
    .max(40),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const loaded = await loadRequest(token);
  if (!loaded) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const { infoRequest, tickets } = loaded;

  const body = await request.json().catch(() => ({}));
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const fields = infoRequest.template.fields as unknown as InfoFormField[];
  const allowedLabels = new Set<string>([
    PARTICIPANT_NAME_LABEL,
    ...fields.map((f) => f.label),
  ]);

  const groups = groupPlaceTickets(tickets);
  const groupByPrimary = new Map(groups.map((g) => [g[0].id, g]));

  for (const answer of parsed.data.answers) {
    const group = groupByPrimary.get(answer.primaryTicketId);
    if (!group) {
      return NextResponse.json(
        { error: `Ticket ${answer.primaryTicketId} gehört nicht zu dieser Anfrage.` },
        { status: 400 },
      );
    }

    // Nur bekannte Labels durchlassen, leere Werte verwerfen.
    const clean: Record<string, string> = {};
    for (const [label, raw] of Object.entries(answer.values)) {
      if (!allowedLabels.has(label)) continue;
      const v = raw.trim();
      if (v) clean[label] = v;
    }

    // Pflichtfelder pruefen (showIf-Felder nur wenn ihr Ja/Nein-Feld = Ja).
    const valueOfKey = (key: string) => {
      const f = fields.find((x) => x.key === key);
      return f ? clean[f.label] : undefined;
    };
    for (const f of fields) {
      const visible = !f.showIfKey || valueOfKey(f.showIfKey) === "Ja";
      if (f.required && visible && !clean[f.label]) {
        return NextResponse.json(
          { error: `Bitte "${f.label}" ausfüllen.` },
          { status: 400 },
        );
      }
    }

    if (Object.keys(clean).length === 0) continue;

    // Antworten auf ALLE Tickets des Platzes schreiben (Wochenticket +
    // Tagestickets), damit der Check-in-Monitor sie an jedem Kurstag zeigt.
    await prisma.ticket.updateMany({
      where: { id: { in: group.map((t) => t.id) }, accountId: infoRequest.accountId },
      data: { guestInfo: clean },
    });
  }

  // Anfrage abschliessen, wenn alle Plaetze beantwortet sind.
  const refreshed = await prisma.ticket.findMany({
    where: {
      id: { in: groups.map((g) => g[0].id) },
      accountId: infoRequest.accountId,
    },
    select: { id: true, guestInfo: true },
  });
  const allAnswered = refreshed.every(
    (t) => t.guestInfo != null && Object.keys(t.guestInfo as object).length > 0,
  );
  await prisma.infoRequest.update({
    where: { id: infoRequest.id },
    data: allAnswered
      ? { status: "COMPLETED", completedAt: new Date() }
      : { status: "SENT" },
  });

  return NextResponse.json({ success: true, completed: allAnswered });
}
