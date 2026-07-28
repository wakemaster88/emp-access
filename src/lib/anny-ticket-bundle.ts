/**
 * Kombi-Tickets zu einem Eintrag je Gast zusammenfassen.
 *
 * Hintergrund: Services wie "Aquapark Tageskarte" umfassen zwei Bereiche
 * (Aquapark + Strandbad). ANNY legt pro Gast eine Buchung JE RESSOURCE an,
 * es entstehen also mehrere EMP-Tickets fuer dieselbe Person. Ungefiltert
 * steht jeder Gast dadurch mehrfach im Shop-Monitor.
 *
 * Warum nicht ueber die Bereiche des Service zaehlen: die Anzahl der
 * `serviceAreas` sagt nur, welche Drehkreuze das Ticket oeffnet - nicht, wie
 * viele Buchungen ANNY anlegt. "Ferienkurs" hat fuenf Bereiche, ANNY erzeugt
 * dort aber nur eine Buchung pro Kind. Wuerde man nach Bereichen buendeln,
 * verschwaenden bei einer Fuenfer-Buchung vier echte Teilnehmer aus der Liste.
 *
 * Zuverlaessig ist allein die gebuchte ANNY-Ressource (`annyResourceId`).
 * Zusammengefasst wird deshalb nur, wenn sich die Tickets eines Gastes an
 * einem Tag auf mehrere Ressourcen verteilen UND jede Ressource gleich oft
 * vorkommt. Beim Ferienkurs liegen alle Buchungen auf derselben Ressource,
 * es entsteht genau eine Spalte und damit ein Eintrag pro Ticket.
 */

/** Minimale Felder, die zum Buendeln noetig sind. */
export interface BundleableTicket {
  id: number;
  /** ANNY-UUID im Format "anny:<customerId>:<serviceId>:<bookingId>". */
  uuid: string | null;
  serviceId: number | null;
  startDate: string | null;
  annyResourceId: string | null;
}

/** Ein Gast: `primary` traegt die Darstellung, `members` sind alle Tickets
 *  dieses Gastes (inklusive `primary`). Bei Einzeltickets enthaelt `members`
 *  genau ein Element. */
export interface TicketBundle<T> {
  primary: T;
  members: T[];
}

const ANNY_UUID_RE = /^anny:([^:]+):([^:]+):(.+)$/;

function parseAnnyUuid(uuid: string | null): { customerId: string; bookingId: string } | null {
  if (!uuid) return null;
  const m = ANNY_UUID_RE.exec(uuid);
  return m ? { customerId: m[1], bookingId: m[3] } : null;
}

/** Buchungen innerhalb einer Ressource chronologisch ordnen. ANNY vergibt
 *  fortlaufende IDs, die Teilbuchungen eines Gastes liegen dadurch an
 *  gleicher Position in allen Ressourcen-Spalten. */
function compareBookingId(a: BundleableTicket, b: BundleableTicket): number {
  const av = parseAnnyUuid(a.uuid)?.bookingId ?? "";
  const bv = parseAnnyUuid(b.uuid)?.bookingId ?? "";
  const an = Number(av);
  const bn = Number(bv);
  if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
  return av.localeCompare(bv);
}

/** Tag der Buchung als "YYYY-MM-DD". Tickets ohne Datum landen in einem
 *  eigenen Topf, damit sie nicht quer ueber Tage zusammenfallen. */
function dayKey(startDate: string | null): string {
  return startDate ? startDate.slice(0, 10) : "";
}

/**
 * Fasst ANNY-Kombi-Tickets zu einem Bundle je Gast zusammen. Die Reihenfolge
 * der Eingabeliste bleibt erhalten (maßgeblich ist die Position des
 * jeweiligen `primary`-Tickets).
 *
 * Nicht zusammengefasst werden Tickets ohne ANNY-Herkunft, ohne
 * `annyResourceId` (z.B. Sync vor diesem Feature) sowie Buchungen mit
 * ungleich verteilten Ressourcen - dort ist im Zweifel ein Eintrag zu viel
 * besser als ein fehlender Gast.
 */
export function bundleAnnyTickets<T extends BundleableTicket>(tickets: T[]): TicketBundle<T>[] {
  const position = new Map<number, number>();
  tickets.forEach((t, i) => position.set(t.id, i));

  const strands = new Map<string, T[]>();
  const result: Array<{ bundle: TicketBundle<T>; at: number }> = [];

  const pushSingle = (t: T) => {
    result.push({ bundle: { primary: t, members: [t] }, at: position.get(t.id) ?? 0 });
  };

  for (const t of tickets) {
    const anny = parseAnnyUuid(t.uuid);
    if (!anny || !t.annyResourceId || t.serviceId == null) {
      pushSingle(t);
      continue;
    }
    const key = `${anny.customerId}|${t.serviceId}|${dayKey(t.startDate)}`;
    const arr = strands.get(key);
    if (arr) arr.push(t);
    else strands.set(key, [t]);
  }

  for (const members of strands.values()) {
    const columns = new Map<string, T[]>();
    for (const t of members) {
      const col = columns.get(t.annyResourceId!);
      if (col) col.push(t);
      else columns.set(t.annyResourceId!, [t]);
    }

    const perResource = [...columns.values()];
    const guestCount = perResource[0].length;
    if (perResource.some((col) => col.length !== guestCount)) {
      // Ungleich verteilt (z.B. eine Teilbuchung storniert oder noch nicht
      // synchronisiert) - Zuordnung waere geraten, also einzeln zeigen.
      for (const t of members) pushSingle(t);
      continue;
    }

    for (const col of perResource) col.sort(compareBookingId);
    for (let guest = 0; guest < guestCount; guest++) {
      const chunk = perResource.map((col) => col[guest]).sort((a, b) => a.id - b.id);
      result.push({
        bundle: { primary: chunk[0], members: chunk },
        at: position.get(chunk[0].id) ?? 0,
      });
    }
  }

  return result.sort((a, b) => a.at - b.at).map((r) => r.bundle);
}
