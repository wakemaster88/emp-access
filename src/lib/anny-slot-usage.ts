/**
 * EMP-eigene Slot-Belegung fuer Services, die sich in ANNY eine Resource
 * teilen.
 *
 * Hintergrund: ANNY rechnet Verfuegbarkeit pro RESOURCE, nicht pro Service.
 * Haengen zwei Services an derselben Resource, senkt jede Buchung des einen
 * Service die freien Plaetze des anderen mit. Beispiel bei Wake & Ski:
 * "Anfaengerkurs - 1 Stunde Uebungslift" (Quota 10) und "Anfaengerkurs -
 * 1 Stunde Seilbahn B" (Quota 15) haengen beide an der Resource
 * "Wake & Ski - Anfaengerkurse" (quantity 15). Drei Buchungen im Uebungslift
 * lassen ANNY auch bei Seilbahn B "3 belegt" melden, obwohl es zwei
 * unabhaengige Bahnen sind.
 *
 * Loesung: Wir fragen die Buchungen der Resource fuer den Tag ab
 * (`GET /bookings?filter[resources]=...&filter[start_date]=...`) und zaehlen
 * sie ueber die `service`-Relation dem jeweiligen ANNY-Service zu. Damit
 * bekommen wir die Belegung, die ANNYs Availability-API in einen Topf wirft,
 * wieder getrennt.
 *
 * Blocker (`is_blocker: true`) haengen an der Resource und haben keine
 * Service-Relation. Sie werden getrennt zurueckgegeben, damit der Aufrufer
 * entscheiden kann: von EMP gesetzte Sperren (IDs stehen in
 * `SlotBlock.annyBookingIds`) gelten nur fuer ihren Service, fremde Blocker
 * aus dem ANNY-Backend sind echte Betriebssperren der ganzen Resource.
 */

import {
  berlinOffset,
  fmtTimeBerlin,
  type ServiceStartSlot,
} from "./anny-availability";

/** ANNY-Buchungsstatus, die einen Platz tatsaechlich belegen. */
const OCCUPYING_STATUSES = new Set(["accepted", "pending"]);

export interface ResourceDayUsage {
  /**
   * Belegte Plaetze je ANNY-Service und Slot-Startzeit ("HH:MM" Berlin):
   * Map<annyServiceId, Map<startTime, count>>.
   */
  byService: Map<string, Map<string, number>>;
  /**
   * Blocker-Buchungen der Resource je Slot-Startzeit ("HH:MM" Berlin) mit
   * ihren ANNY-Booking-IDs.
   */
  blockersByStart: Map<string, string[]>;
}

interface JsonApiBooking {
  id?: string;
  attributes?: {
    status?: string;
    is_blocker?: boolean;
    start_date?: string;
    end_date?: string;
    weight?: number;
  };
  relationships?: {
    service?: { data?: { id?: string } | null };
  };
}

function emptyUsage(): ResourceDayUsage {
  return { byService: new Map(), blockersByStart: new Map() };
}

/**
 * Holt alle Buchungen einer ANNY-Resource an einem Tag und gruppiert sie nach
 * Service und Slot-Startzeit.
 *
 * `filter[start_date]` erwartet ein Datum (YYYY-MM-DD) und matcht auf den
 * Buchungsbeginn. ANNY liefert `start_date` in UTC, deshalb konvertieren wir
 * die Slot-Keys nach Berlin-Zeit - dieselbe Basis, die
 * `fetchAnnyServiceStartSlots` fuer `startTime` verwendet.
 *
 * Der Tagesfilter kann Slots am Rand verpassen, wenn ANNY und Berlin-Zeit
 * ueber Mitternacht auseinanderlaufen. Wir fragen daher Vor- und Folgetag mit
 * ab und verwerfen alles, was nicht in den Berlin-Tag faellt.
 */
export async function fetchAnnyResourceDayUsage(
  baseUrl: string,
  token: string,
  resourceId: string,
  dateStr: string,
  organizationId?: string | null,
): Promise<ResourceDayUsage> {
  if (!resourceId || !dateStr) return emptyUsage();

  const tz = berlinOffset(dateStr);
  const dayStartMs = new Date(`${dateStr}T00:00:00${tz}`).getTime();
  const dayEndMs = new Date(`${dateStr}T23:59:59${tz}`).getTime();

  const dayMs = 86400000;
  const dates = [
    new Date(dayStartMs - dayMs).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }),
    dateStr,
    new Date(dayStartMs + dayMs).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }),
  ];

  const cleanBase = baseUrl.replace(/\/+$/, "");
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.api+json, application/json",
  };

  const pages = await Promise.all(
    dates.map(async (d) => {
      const params = new URLSearchParams({
        "filter[resources]": resourceId,
        "filter[start_date]": d,
        "page[size]": "200",
        "page[number]": "1",
      });
      if (organizationId) params.set("o", organizationId);
      try {
        const res = await fetch(`${cleanBase}/api/v1/bookings?${params}`, {
          headers,
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return [] as JsonApiBooking[];
        const json = (await res.json()) as { data?: JsonApiBooking[] };
        return Array.isArray(json?.data) ? json.data : [];
      } catch {
        return [] as JsonApiBooking[];
      }
    }),
  );

  const usage = emptyUsage();
  const seen = new Set<string>();

  for (const booking of pages.flat()) {
    const id = booking.id;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const attrs = booking.attributes ?? {};
    const status = (attrs.status ?? "").toLowerCase();
    if (!OCCUPYING_STATUSES.has(status)) continue;
    const startIso = attrs.start_date;
    if (!startIso) continue;
    const startMs = new Date(startIso).getTime();
    if (!Number.isFinite(startMs) || startMs < dayStartMs || startMs > dayEndMs) continue;
    const startTime = fmtTimeBerlin(startIso);
    if (!startTime) continue;

    if (attrs.is_blocker) {
      const list = usage.blockersByStart.get(startTime) ?? [];
      if (id) list.push(id);
      usage.blockersByStart.set(startTime, list);
      continue;
    }

    const serviceId = booking.relationships?.service?.data?.id;
    if (!serviceId) continue;
    // `weight` ist ANNYs Platz-Gewichtung pro Buchung (default 1). Bei
    // Kursen mit max_booking_quantity=1 ist das immer 1, bei Services mit
    // Mengenbuchung entspricht es der Personenzahl.
    const weight = typeof attrs.weight === "number" && attrs.weight > 0 ? attrs.weight : 1;
    const perService = usage.byService.get(serviceId) ?? new Map<string, number>();
    perService.set(startTime, (perService.get(startTime) ?? 0) + weight);
    usage.byService.set(serviceId, perService);
  }

  return usage;
}

/**
 * Zaehlt die Belegung eines Slots aus allen bekannten Quellen zusammen.
 *
 * `annyBookings` (ANNY-Buchungen dieses Service) und `empTickets` (lokal
 * verkaufte Tickets) ueberschneiden sich: ein Verkauf am Schalter legt in ANNY
 * eine Buchung an und erzeugt ein EMP-Ticket. Wir nehmen deshalb das Maximum
 * statt der Summe - so zaehlen wir nicht doppelt, verlieren aber auch keine
 * Tickets, deren ANNY-Buchung fehlgeschlagen ist.
 */
export function combineSlotUsage(annyBookings: number, empTickets: number): number {
  return Math.max(0, annyBookings, empTickets);
}

/**
 * ANNY-Gruende, die "der Slot ist voll" bedeuten. Genau diese Aussage ist bei
 * geteilten Resources unbrauchbar (sie zaehlt die Buchungen des anderen
 * Service mit) und wird durch unsere eigene Rechnung ersetzt. Alle anderen
 * Gruende (zu kurz, geschlossen, Konflikt, ...) bleiben unangetastet.
 */
const REPLACEABLE_UNAVAILABILITY = new Set(["booked_out", "overbooked"]);

export interface OwnCapacityOptions {
  /** Plaetze pro Slot laut `Service.slotCapacity`. */
  slotCapacity: number;
  /** ANNY-Service-IDs, die zu diesem EMP-Service gehoeren. */
  annyServiceIds: string[];
  /** Buchungen und Blocker der geteilten Resource an diesem Tag. */
  usage: ResourceDayUsage;
  /**
   * ANNY-Booking-IDs von Blockern, die diesen Service NICHT sperren duerfen:
   * die Sperren, die EMP fuer die ANDEREN Services derselben Resource gesetzt
   * hat (aus `SlotBlock.annyBookingIds`). Sie liegen technisch auf der
   * geteilten Resource, gelten fachlich aber nur fuer ihren eigenen Service.
   *
   * Alles, was nicht in dieser Menge steht, sperrt weiterhin - die eigene
   * Sperre dieses Service ebenso wie Blocker aus dem ANNY-Backend, die echte
   * Betriebssperren der ganzen Resource sind.
   */
  ignoredBlockerIds?: Set<string>;
  /** Lokale EMP-Tickets je Slot-Startzeit ("HH:MM"). */
  empBookingsByStart?: Map<string, number>;
}

/**
 * Ersetzt in den ANNY-Slots Kapazitaet und Restplaetze durch die EMP-eigene
 * Rechnung. Anzuwenden NACH `applyLocalSalesOverrides`.
 *
 * `capacity` wird die konfigurierte Slot-Kapazitaet, `remaining` ergibt sich
 * aus den Buchungen, die ANNY diesem Service (nicht der Resource) zuordnet.
 */
export function applyOwnSlotCapacity(
  slots: ServiceStartSlot[],
  opts: OwnCapacityOptions,
): ServiceStartSlot[] {
  const { slotCapacity, annyServiceIds, usage, ignoredBlockerIds, empBookingsByStart } = opts;
  if (!Number.isFinite(slotCapacity) || slotCapacity <= 0) return slots;

  return slots.map((slot) => {
    let bookings = 0;
    for (const sid of annyServiceIds) {
      bookings += usage.byService.get(sid)?.get(slot.startTime) ?? 0;
    }
    const used = combineSlotUsage(bookings, empBookingsByStart?.get(slot.startTime) ?? 0);
    const remaining = Math.max(0, slotCapacity - used);

    const blockerIds = usage.blockersByStart.get(slot.startTime) ?? [];
    const isBlocked = blockerIds.some((id) => !ignoredBlockerIds?.has(id));

    const next: ServiceStartSlot = { ...slot, capacity: slotCapacity, remaining };

    if (isBlocked) {
      next.available = false;
      next.unavailabilityType = "blocked";
      return next;
    }

    // Nur ANNYs "voll"-Aussage ersetzen - andere Gruende sind unabhaengig von
    // der geteilten Kapazitaet und bleiben erhalten.
    const reason = slot.unavailabilityType;
    if (!reason || REPLACEABLE_UNAVAILABILITY.has(reason)) {
      if (remaining > 0) {
        next.available = true;
        delete next.unavailabilityType;
      } else {
        next.available = false;
        next.unavailabilityType = "booked_out";
      }
    }
    return next;
  });
}
