/**
 * Veranstaltungen in Veranstaltungsraeumen (z. B. Rooftop Lounge): Termine
 * anlegen und aendern mit Pruefung auf Doppelbelegung, Zusatzleistungen mit
 * Preis-Schnappschuss, Verlauf und Benachrichtigungen. Gemeinsam genutzt vom
 * Backoffice (`/api/veranstaltungen/…`) und vom Partner-Portal
 * (`/api/partner-portal/<token>/…`).
 *
 * Alle Abfragen geben `accountId` selbst mit (wie das Vereinsportal), weil
 * das Partner-Portal ohne Sitzung laeuft.
 */
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email-sender";
import { escapeHtml } from "@/lib/email-templates";
import { sendPushToAccount } from "@/lib/web-push";
import { addCalendarDays, berlinYmd } from "@/lib/berlin-day";
import {
  billableGuests,
  describeChanges,
  DOCUMENT_KIND_LABEL,
  eventTimes,
  extrasKey,
  extrasTotalCents,
  formatEventDay,
  formatEventTime,
  MAX_EVENT_HOURS,
  overlapsWithBuffer,
  partnerEditState,
  type EventInput,
  type VenueDocumentKind,
  type VenueEventStatus,
  type VenueExtraUnit,
} from "@/lib/venue-event-rules";

export type Actor = { by: "PARTNER" | "ADMIN"; name: string | null };

export function generatePartnerToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Partner zum Portal-Link, nur wenn das Portal eingeschaltet ist. */
export async function loadPortalPartner(token: string) {
  if (!token || token.length < 16 || token.length > 100) return null;
  const partner = await prisma.eventPartner.findUnique({
    where: { portalToken: token },
    include: { account: { select: { name: true } } },
  });
  if (!partner || !partner.portalEnabled) return null;
  return partner;
}
export type PortalPartner = NonNullable<Awaited<ReturnType<typeof loadPortalPartner>>>;

/** Veranstaltungsraeume des Mandanten (optional nur bestimmte). */
export async function loadVenues(accountId: number, onlyIds?: number[]) {
  return prisma.accessArea.findMany({
    where: { accountId, eventVenue: true, ...(onlyIds ? { id: { in: onlyIds } } : {}) },
    select: { id: true, name: true, eventBufferMinutes: true, eventCapacity: true },
    orderBy: { name: "asc" },
  });
}

/** Volle Termin-Zeile mit allem, was die Ansichten brauchen. */
export const eventInclude = {
  area: { select: { id: true, name: true } },
  partner: { select: { id: true, name: true } },
  extras: { orderBy: { id: "asc" } },
  documents: {
    select: { id: true, kind: true, fileName: true, size: true, reference: true, amountCents: true, createdAt: true, viewedAt: true },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.VenueEventInclude;

export type EventRow = Prisma.VenueEventGetPayload<{ include: typeof eventInclude }>;

function hasFinalInvoice(e: { documents: { kind: VenueDocumentKind }[] }): boolean {
  return e.documents.some((d) => d.kind === "FINAL_INVOICE");
}

function serializeBase(e: EventRow) {
  const guests = billableGuests(e);
  return {
    id: e.id,
    areaId: e.areaId,
    areaName: e.area.name,
    title: e.title,
    hostName: e.hostName,
    date: e.date,
    startTime: e.startTime,
    endTime: e.endTime,
    startDate: e.startDate.toISOString(),
    endDate: e.endDate.toISOString(),
    guestCount: e.guestCount,
    actualGuests: e.actualGuests,
    status: e.status as VenueEventStatus,
    note: e.note,
    createdBy: e.createdBy,
    createdByName: e.createdByName,
    billed: !!e.billedAt,
    past: e.endDate.getTime() <= Date.now(),
    extras: e.extras.map((x) => ({
      extraId: x.extraId,
      name: x.name,
      unit: x.unit as VenueExtraUnit,
      unitPriceCents: x.unitPriceCents,
      quantity: x.quantity,
    })),
    extrasTotalCents: extrasTotalCents(
      e.extras.map((x) => ({ unit: x.unit as VenueExtraUnit, unitPriceCents: x.unitPriceCents, quantity: x.quantity })),
      guests,
    ),
    documents: e.documents.map((d) => ({
      id: d.id,
      kind: d.kind as VenueDocumentKind,
      fileName: d.fileName,
      size: d.size,
      reference: d.reference,
      amountCents: d.amountCents,
      createdAt: d.createdAt.toISOString(),
      viewed: !!d.viewedAt,
    })),
  };
}

/** Sicht des Backoffice: alles, inkl. interner Notiz und Partner. */
export function serializeEventForAdmin(e: EventRow) {
  return {
    ...serializeBase(e),
    partnerId: e.partnerId,
    partnerName: e.partner?.name ?? null,
    internalNote: e.internalNote,
    canceledBy: e.canceledBy,
    billedAt: e.billedAt?.toISOString() ?? null,
  };
}
export type AdminEvent = ReturnType<typeof serializeEventForAdmin>;

/** Sicht des Partners: ohne interne Notiz, mit dem, was er noch darf. */
export function serializeEventForPartner(e: EventRow, editLockHours: number) {
  const state = partnerEditState(
    { status: e.status as VenueEventStatus, startDate: e.startDate, billedAt: e.billedAt, hasFinalInvoice: hasFinalInvoice(e) },
    editLockHours,
  );
  return { ...serializeBase(e), ...state };
}
export type PartnerEvent = ReturnType<typeof serializeEventForPartner>;

/** Fremde Belegungen fuer den Partner: nur Raum und Zeit, keine Details. */
export async function loadBusyBlocks(accountId: number, areaIds: number[], partnerId: number, from: Date, to: Date) {
  if (areaIds.length === 0) return [];
  const rows = await prisma.venueEvent.findMany({
    where: {
      accountId,
      areaId: { in: areaIds },
      status: { not: "CANCELED" },
      OR: [{ partnerId: null }, { partnerId: { not: partnerId } }],
      endDate: { gt: from },
      startDate: { lt: to },
    },
    select: { areaId: true, date: true, startTime: true, endTime: true, startDate: true, endDate: true },
    orderBy: { startDate: "asc" },
    take: 500,
  });
  return rows.map((r) => ({
    areaId: r.areaId,
    date: r.date,
    startTime: r.startTime,
    endTime: r.endTime,
  }));
}

export type SaveResult =
  | { ok: true; event: EventRow; changes: string[] }
  | { ok: false; status: number; error: string };

interface SaveOptions {
  accountId: number;
  actor: Actor;
  input: EventInput;
  /** Neuer Termin: Partner (oder null fuer eigenen Termin). */
  partnerId?: number | null;
  /** Bestehender Termin (Aenderung). */
  eventId?: number;
  /** Partner-Regeln: Raeume, Vorlauf, nicht in der Vergangenheit, nur aktive Zusatzleistungen. */
  partnerRules?: { areaIds: number[]; horizonDays: number };
  /** Nur Backoffice. */
  internalNote?: string | null;
  /** Abgesagten Termin wieder aufnehmen (prueft die Belegung neu). */
  reopen?: boolean;
}

/**
 * Legt einen Termin an oder aendert ihn. Prueft Raum, Zeit, Kapazitaet und
 * Doppelbelegung (samt Puffer) unter einer Sperre je Raum, damit zwei
 * gleichzeitige Eintraege nicht beide durchkommen.
 */
export async function saveEvent(opts: SaveOptions): Promise<SaveResult> {
  const { accountId, actor, input, partnerRules } = opts;
  const times = eventTimes(input.date, input.startTime, input.endTime);
  if (!times) return { ok: false, status: 400, error: "Ungültige Zeit." };
  if (times.endDate.getTime() - times.startDate.getTime() > MAX_EVENT_HOURS * 3_600_000) {
    return { ok: false, status: 400, error: `Eine Veranstaltung dauert höchstens ${MAX_EVENT_HOURS} Stunden.` };
  }

  const area = await prisma.accessArea.findFirst({
    where: { id: input.areaId, accountId, eventVenue: true },
    select: { id: true, name: true, eventBufferMinutes: true, eventCapacity: true },
  });
  if (!area) return { ok: false, status: 400, error: "Diesen Raum gibt es nicht (mehr)." };

  if (partnerRules) {
    if (!partnerRules.areaIds.includes(area.id)) return { ok: false, status: 403, error: "Für diesen Raum seid ihr nicht freigeschaltet." };
    if (times.startDate.getTime() <= Date.now()) return { ok: false, status: 400, error: "Der Beginn liegt in der Vergangenheit." };
    const last = addCalendarDays(berlinYmd(new Date()), partnerRules.horizonDays);
    if (input.date > last) return { ok: false, status: 400, error: `Eintragen geht höchstens ${partnerRules.horizonDays} Tage im Voraus.` };
  }
  if (area.eventCapacity != null && input.guestCount > area.eventCapacity) {
    return { ok: false, status: 400, error: `In ${area.name} passen höchstens ${area.eventCapacity} Personen.` };
  }

  // Zusatzleistungen des Raums; der Partner sieht nur aktive.
  const extraIds = [...new Set(input.extras.map((x) => x.extraId))];
  const catalog = extraIds.length
    ? await prisma.venueExtra.findMany({
        where: { accountId, areaId: area.id, id: { in: extraIds }, ...(partnerRules ? { active: true } : {}) },
      })
    : [];
  const byId = new Map(catalog.map((c) => [c.id, c]));

  try {
    return await prisma.$transaction(async (tx) => {
      // Sperre je Raum bis Transaktionsende: verhindert parallele Doppelbuchung.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${7_700_000_000 + area.id})`;

      let existing: (EventRow & { partnerId: number | null }) | null = null;
      if (opts.eventId != null) {
        existing = await tx.venueEvent.findFirst({ where: { id: opts.eventId, accountId }, include: eventInclude });
        if (!existing) return { ok: false, status: 404, error: "Termin nicht gefunden." } as const;
        if (existing.status === "CANCELED" && !opts.reopen) return { ok: false, status: 409, error: "Der Termin ist abgesagt." } as const;
      }

      // Zusatzleistungen, die schon gebucht sind, behalten ihren alten Preis
      // (und bleiben auch, wenn sie inzwischen ausgeblendet sind).
      const previous = new Map((existing?.extras ?? []).filter((x) => x.extraId != null).map((x) => [x.extraId!, x]));
      const lines: Array<{ extraId: number; name: string; unit: VenueExtraUnit; unitPriceCents: number; quantity: number }> = [];
      for (const sel of input.extras) {
        const prev = previous.get(sel.extraId);
        const cat = byId.get(sel.extraId);
        const unit = (prev?.unit ?? cat?.unit) as VenueExtraUnit | undefined;
        if (!unit) continue;
        lines.push({
          extraId: sel.extraId,
          name: prev?.name ?? cat!.name,
          unit,
          unitPriceCents: prev?.unitPriceCents ?? cat!.priceCents,
          quantity: unit === "PER_PIECE" ? sel.quantity : 1,
        });
      }

      const others = await tx.venueEvent.findMany({
        where: {
          accountId,
          areaId: area.id,
          status: { not: "CANCELED" },
          ...(existing ? { id: { not: existing.id } } : {}),
          startDate: { lt: new Date(times.endDate.getTime() + area.eventBufferMinutes * 60_000) },
          endDate: { gt: new Date(times.startDate.getTime() - area.eventBufferMinutes * 60_000) },
        },
        select: { id: true, startDate: true, endDate: true, date: true, startTime: true, endTime: true },
      });
      const clash = others.find((o) => overlapsWithBuffer(o, times, area.eventBufferMinutes));
      if (clash) {
        const buffer = area.eventBufferMinutes > 0 ? ` (mit ${area.eventBufferMinutes} Min. für Auf- und Abbau)` : "";
        return {
          ok: false,
          status: 409,
          error: `${area.name} ist am ${formatEventDay(clash.date)} von ${clash.startTime} bis ${clash.endTime} Uhr schon belegt${buffer}.`,
        } as const;
      }

      const data = {
        areaId: area.id,
        title: input.title,
        hostName: input.hostName,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        startDate: times.startDate,
        endDate: times.endDate,
        guestCount: input.guestCount,
        note: input.note,
        ...(opts.internalNote !== undefined ? { internalNote: opts.internalNote } : {}),
        ...(opts.reopen ? { status: "RESERVED" as const, canceledAt: null, canceledBy: null } : {}),
      };

      let eventId: number;
      let changes: string[];
      if (existing) {
        changes = describeChanges(
          { ...existing, extrasKey: extrasKey(existing.extras) },
          { ...data, extrasKey: extrasKey(lines) },
        );
        if (existing.areaId !== area.id) changes.unshift(`Raum ${area.name}`);
        if (opts.reopen) changes.unshift("Wieder aufgenommen");
        await tx.venueEvent.update({ where: { id: existing.id }, data });
        await tx.venueEventExtra.deleteMany({ where: { eventId: existing.id } });
        eventId = existing.id;
      } else {
        const created = await tx.venueEvent.create({
          data: {
            ...data,
            accountId,
            partnerId: opts.partnerId ?? null,
            createdBy: actor.by,
            createdByName: actor.name,
          },
          select: { id: true },
        });
        eventId = created.id;
        changes = ["Eingetragen"];
      }
      if (lines.length > 0) {
        await tx.venueEventExtra.createMany({ data: lines.map((l) => ({ ...l, eventId })) });
      }
      if (changes.length > 0) {
        await tx.venueEventChange.create({
          data: { eventId, by: actor.by, byName: actor.name, summary: changes.join(", ").slice(0, 500) },
        });
      }
      const event = await tx.venueEvent.findFirstOrThrow({ where: { id: eventId, accountId }, include: eventInclude });
      return { ok: true, event, changes } as const;
    });
  } catch (err) {
    console.error("[venue-events] save failed:", err);
    return { ok: false, status: 500, error: "Speichern fehlgeschlagen." };
  }
}

/** Verlaufseintrag ausserhalb von saveEvent (Absage, Bestaetigung, Dokument …). */
export async function logChange(eventId: number, actor: Actor, summary: string) {
  await prisma.venueEventChange.create({ data: { eventId, by: actor.by, byName: actor.name, summary: summary.slice(0, 500) } });
}

export async function loadEvent(accountId: number, eventId: number) {
  return prisma.venueEvent.findFirst({ where: { id: eventId, accountId }, include: eventInclude });
}

// ─── Benachrichtigungen ─────────────────────────────────────────────────────

function eventLine(e: { title: string; date: string; startTime: string; endTime: string; area: { name: string } }): string {
  return `${e.title} · ${e.area.name} · ${formatEventDay(e.date)} ${formatEventTime(e.startTime, e.endTime)}`;
}

async function sendMail(accountId: number, to: string | null | undefined, subject: string, lines: string[], link?: { url: string; label: string }) {
  if (!to) return;
  const config = await prisma.emailConfig.findUnique({ where: { accountId } });
  if (!config || !config.isActive || !config.apiKey) return;
  const text = [...lines, ...(link ? ["", `${link.label}: ${link.url}`] : [])].join("\n");
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.5">${lines
    .map((l) => `<p style="margin:0 0 8px">${escapeHtml(l)}</p>`)
    .join("")}${link ? `<p style="margin:16px 0 0"><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></p>` : ""}</div>`;
  const result = await sendEmail({ config, to, subject, html, text });
  await prisma.emailSend
    .create({
      data: {
        accountId,
        to,
        subject,
        status: result.ok ? "SENT" : "FAILED",
        errorMessage: result.ok ? null : (result.error ?? "Unbekannter Fehler").slice(0, 500),
      },
    })
    .catch(() => undefined);
}

/**
 * Meldung an uns, wenn der Partner etwas eintraegt, aendert oder absagt:
 * Push an alle Geraete des Mandanten, dazu Mail an `notifyEmail`.
 */
export async function notifyStaff(
  partner: { name: string; notifyEmail: string | null; accountId: number },
  event: EventRow,
  what: string,
  origin: string,
) {
  const title = `${partner.name}: ${what}`;
  const body = eventLine(event) + ` · ${billableGuests(event)} Pers.`;
  await Promise.allSettled([
    sendPushToAccount(partner.accountId, { title, body, url: `/veranstaltungen?termin=${event.id}`, tag: `venue-event-${event.id}` }),
    sendMail(partner.accountId, partner.notifyEmail, title, [title, body], {
      url: `${origin}/veranstaltungen?termin=${event.id}`,
      label: "Termin öffnen",
    }),
  ]);
}

/** Meldung an den Partner (Bestaetigung, Absage, neues Dokument). Ohne Anhang, nur mit Link. */
export async function notifyPartner(
  partner: { accountId: number; contactEmail: string | null; portalToken: string | null; portalEnabled: boolean },
  event: EventRow,
  subject: string,
  message: string,
  origin: string,
) {
  if (!partner.contactEmail) return;
  const link = partner.portalEnabled && partner.portalToken ? { url: `${origin}/partner/${partner.portalToken}`, label: "Zu euren Terminen" } : undefined;
  await sendMail(partner.accountId, partner.contactEmail, subject, [message, eventLine(event)], link).catch((e) =>
    console.error("[venue-events] partner mail failed:", e),
  );
}

export function documentMessage(kind: VenueDocumentKind): string {
  return `Neues Dokument: ${DOCUMENT_KIND_LABEL[kind]}. Ihr findet es bei eurem Termin.`;
}
