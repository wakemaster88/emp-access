/**
 * Info-Anfragen: Gaeste bekommen per Mail einen Link zu einem oeffentlichen
 * Formular (/info/<token>) und beantworten dort pro Kursplatz Zusatzfragen
 * (z. B. Ferienkurs: Wasserski/Wakeboard, Schuhgroesse, Level, Neopren).
 * Die Antworten landen als Label->Wert-JSON in `Ticket.guestInfo` und werden
 * im Check-in-Monitor als Badges angezeigt.
 */

import { z } from "zod";

/** Feld-Definition eines InfoFormTemplate (JSON-Spalte `fields`). */
export interface InfoFormField {
  /** Stabiler Schluessel innerhalb des Templates (z. B. "sport"). */
  key: string;
  /** Anzeige-Label; wird auch als Schluessel in `Ticket.guestInfo` benutzt. */
  label: string;
  type: "choice" | "text" | "number" | "boolean";
  /** Antwort-Optionen fuer type="choice". */
  options?: string[];
  required?: boolean;
  /**
   * Nur anzeigen, wenn das referenzierte boolean-Feld mit "Ja" beantwortet
   * wurde (z. B. Neopren-Groesse nur wenn Neopren=Ja).
   */
  showIfKey?: string;
}

export const infoFormFieldSchema = z.object({
  key: z.string().min(1).max(60).regex(/^[a-zA-Z0-9_-]+$/),
  label: z.string().min(1).max(80),
  type: z.enum(["choice", "text", "number", "boolean"]),
  options: z.array(z.string().min(1).max(80)).max(30).optional(),
  required: z.boolean().optional(),
  showIfKey: z.string().max(60).optional(),
});

export const infoFormFieldsSchema = z
  .array(infoFormFieldSchema)
  .min(1)
  .max(25)
  .superRefine((fields, ctx) => {
    const keys = new Set<string>();
    for (const f of fields) {
      if (keys.has(f.key)) {
        ctx.addIssue({ code: "custom", message: `Doppelter Feld-Key: ${f.key}` });
      }
      keys.add(f.key);
      if (f.type === "choice" && (!f.options || f.options.length < 2)) {
        ctx.addIssue({ code: "custom", message: `Feld "${f.label}" braucht mindestens 2 Optionen` });
      }
    }
    for (const f of fields) {
      if (f.showIfKey && !fields.some((o) => o.key === f.showIfKey && o.type === "boolean")) {
        ctx.addIssue({ code: "custom", message: `showIfKey "${f.showIfKey}" verweist auf kein Ja/Nein-Feld` });
      }
    }
  });

export const infoTemplateCreateSchema = z.object({
  name: z.string().min(1).max(120),
  introText: z.string().max(2000).nullable().optional(),
  fields: infoFormFieldsSchema,
  askParticipantName: z.boolean().optional(),
});

/** Label, unter dem der Teilnehmername in `Ticket.guestInfo` gespeichert wird. */
export const PARTICIPANT_NAME_LABEL = "Teilnehmer";

/** Default-Vorlage fuer den Ferienkurs (Schnell-Setup im Dashboard). */
export const FERIENKURS_DEFAULT_TEMPLATE = {
  name: "Ferienkurs-Infos",
  introText:
    "Damit der Kurs-Check-in schneller geht, brauchen wir vorab ein paar Infos zu jedem Teilnehmer. Bitte fülle das Formular für jeden gebuchten Kursplatz aus – dauert keine 2 Minuten.",
  askParticipantName: true,
  fields: [
    { key: "sport", label: "Sport", type: "choice", options: ["Wasserski", "Wakeboard"], required: true },
    { key: "level", label: "Level", type: "choice", options: ["Anfänger", "Fortgeschritten", "Profi"], required: true },
    { key: "schuhgroesse", label: "Schuhgröße", type: "number", required: true },
    { key: "neopren", label: "Neoprenanzug leihen", type: "boolean", required: true },
    {
      key: "neoprenGroesse",
      label: "Neopren-Größe",
      type: "choice",
      options: ["128", "140", "152", "164", "XS", "S", "M", "L", "XL", "XXL"],
      showIfKey: "neopren",
    },
  ] satisfies InfoFormField[],
};

/* ──────────────────────────────────────────────────────────────────────────
 * Kursplatz-Gruppierung
 *
 * Ein Ferienkurs-Platz besteht in ANNY aus einem Wochenticket (Mo-Fr) plus
 * fuenf Tagestickets. Die Booking-IDs (letztes Segment der uuid
 * "anny:<customer>:<svc>:<bookingId>") sind pro Platz fortlaufend vergeben:
 * erst das Wochenticket, dann dessen Tagestickets. Wir sortieren daher nach
 * Booking-ID und haengen Eintages-Tickets an das zuletzt gesehene
 * Mehrtages-Ticket an. Tickets ohne parsebare ID oder vor dem ersten
 * Mehrtages-Ticket bilden eigene Ein-Ticket-Plaetze (generisches Verhalten
 * fuer Services ohne Wochenstruktur).
 * ────────────────────────────────────────────────────────────────────────── */

export interface GroupableTicket {
  id: number;
  uuid: string | null;
  startDate: Date | null;
  endDate: Date | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isMultiDayTicket(t: GroupableTicket): boolean {
  return !!(
    t.startDate &&
    t.endDate &&
    t.endDate.getTime() - t.startDate.getTime() > MS_PER_DAY
  );
}

function bookingIdOf(t: GroupableTicket): number | null {
  if (!t.uuid) return null;
  const parts = t.uuid.split(":");
  const last = parts[parts.length - 1];
  const n = Number(last);
  return Number.isFinite(n) && parts.length >= 2 ? n : null;
}

/** Gruppiert Tickets einer Email-Adresse zu Kursplaetzen. */
export function groupPlaceTickets<T extends GroupableTicket>(tickets: T[]): T[][] {
  const withId = tickets
    .map((t) => ({ t, bid: bookingIdOf(t) }))
    .filter((x): x is { t: T; bid: number } => x.bid != null)
    .sort((a, b) => a.bid - b.bid);
  const withoutId = tickets.filter((t) => bookingIdOf(t) == null);

  const groups: T[][] = [];
  let current: T[] | null = null;
  for (const { t } of withId) {
    if (isMultiDayTicket(t)) {
      current = [t];
      groups.push(current);
    } else if (
      current &&
      current[0].startDate &&
      current[0].endDate &&
      t.startDate &&
      t.startDate >= new Date(current[0].startDate.getTime() - MS_PER_DAY) &&
      t.startDate <= current[0].endDate
    ) {
      // Tagesticket innerhalb des Zeitraums des aktuellen Wochentickets.
      current.push(t);
    } else {
      // Einzelticket ausserhalb einer Wochenstruktur -> eigener Platz.
      groups.push([t]);
      current = null;
    }
  }
  for (const t of withoutId) groups.push([t]);
  return groups;
}

/**
 * ANNY-Buchungsnummer eines Tickets (letztes Segment der uuid
 * "anny:<customer>:<svc>:<bookingId>"). null bei Tickets ohne ANNY-Herkunft.
 */
export function bookingNumberOf(t: { uuid: string | null }): string | null {
  if (!t.uuid?.startsWith("anny:")) return null;
  const parts = t.uuid.split(":");
  const last = parts[parts.length - 1];
  return /^\d+$/.test(last) ? last : null;
}

/** "Mo. 20.07. – Fr. 24.07.2026" bzw. "Mo. 20.07.2026" fuer die Platz-Anzeige. */
export function formatPlaceRange(t: GroupableTicket): string {
  const TZ = "Europe/Berlin";
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString("de-DE", {
      timeZone: TZ,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      ...(withYear ? { year: "numeric" } : {}),
    });
  if (t.startDate && t.endDate && isMultiDayTicket(t)) {
    return `${fmt(t.startDate, false)} – ${fmt(t.endDate, true)}`;
  }
  if (t.startDate) return fmt(t.startDate, true);
  return "";
}

/* ──────────────────────────────────────────────────────────────────────────
 * Mail-Inhalt
 * ────────────────────────────────────────────────────────────────────────── */

export function buildInfoRequestInnerHtml(args: {
  accountName: string;
  serviceName: string;
  formUrl: string;
  placeCount: number;
  firstName?: string | null;
}): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const anrede = args.firstName ? `Hallo ${esc(args.firstName)}` : "Hallo";
  const plaetze =
    args.placeCount === 1
      ? "deinen gebuchten Kursplatz"
      : `deine ${args.placeCount} gebuchten Kursplätze`;
  return `<div style="font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#76716a;margin-bottom:8px;">${esc(args.serviceName)}</div>
<h1 style="margin:0 0 18px;font-size:26px;font-weight:800;line-height:1.2;color:#0f0f10;letter-spacing:-0.01em;">${anrede}, wir brauchen noch ein paar Infos.</h1>

<p style="margin:0 0 14px;color:#3a3a3e;">Damit beim <strong>${esc(args.serviceName)}</strong> alles reibungslos läuft und der Check-in vor Ort schneller geht, beantworte bitte vorab ein paar kurze Fragen für ${plaetze} – z. B. Schuhgröße und ob ein Neoprenanzug gebraucht wird.</p>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;">
  <tr><td align="center"><a href="${esc(args.formUrl)}" style="display:inline-block;background:#1a6d73;color:#ffffff;padding:15px 36px;border-radius:9999px;text-decoration:none;font-weight:600;font-size:15.5px;letter-spacing:0.02em;">Infos jetzt ausfüllen</a></td></tr>
</table>

<p style="margin:0 0 6px;color:#76716a;font-size:13.5px;">Das Ausfüllen dauert keine 2 Minuten. Falls der Button nicht funktioniert, öffne diesen Link:<br/><a href="${esc(args.formUrl)}" style="color:#1a6d73;word-break:break-all;">${esc(args.formUrl)}</a></p>

<div style="border-top:1px solid #ece4d3;margin:26px 0 18px;"></div>
<p style="margin:0;color:#3a3a3e;font-size:14px;line-height:1.6;">
  Vielen Dank!<br/>
  <strong style="color:#0f0f10;">Dein ${esc(args.accountName)}-Team</strong>
</p>`;
}
