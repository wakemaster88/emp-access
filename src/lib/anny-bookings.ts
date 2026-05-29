/**
 * ANNY-Booking schreiben: legt eine Buchung in ANNY an, damit die Slot-
 * Kapazitaet dort reduziert wird. Ziel ist, dass ein Verkauf im EMP-Access-
 * Check-In sich auch im ANNY-Backoffice / in den ANNY-Slot-Anzeigen
 * widerspiegelt (sonst Risiko der Doppelbuchung, weil unser Slot-Picker
 * live aus ANNY liest, ANNY aber von unserem Verkauf nichts weiss).
 *
 * Verwendet `POST /api/v1/orders/from-config` aus dem Admin-API.
 * Siehe https://developers.anny.co/guides/admin/booking-creation.
 */

export interface CreateAnnyBookingInput {
  baseUrl: string;
  token: string;
  serviceUuid: string;
  resourceUuid: string;
  startIso: string;
  endIso: string;
  description?: string;
  /**
   * notify_customer: true -> ANNY mailt dem (anonymen) Kunden. Wir lassen es
   * standardmaessig auf false, weil das Ticket im EMP-Access bereits separat
   * kommuniziert wird und wir keinen Kunden-Datensatz in ANNY anlegen.
   */
  notifyCustomer?: boolean;
  /**
   * check_availability: true -> ANNY weist die Buchung ab, wenn der Slot
   * voll ist. Empfohlener Default, sonst riskieren wir Overbooking, weil
   * wir die Live-Slots ein paar Sekunden vor dem POST gelesen haben.
   */
  checkAvailability?: boolean;
  /** Optionale Organization-ID (?o=...) - manche Token-Setups brauchen das. */
  organizationId?: string | null;
  /**
   * Anzahl der zu buchenden Plaetze (service_id-Map-Wert). Default 1.
   * Wird beim Slot-Sperren auf die volle Restkapazitaet gesetzt, damit der
   * Slot in ANNY komplett belegt ist.
   */
  quantity?: number;
}

export interface CreateAnnyBookingResult {
  /** UUID der angelegten Booking (NICHT der Order) - fuer spaeteren Storno. */
  bookingId: string | null;
  /** Alle Booking-UUIDs des Orders (fuer Storno aller erzeugten Buchungen). */
  bookingIds: string[];
  /** UUID des Orders. */
  orderId: string | null;
  /** True = ANNY hat die Buchung angenommen. */
  ok: boolean;
  /** Roh-Status der HTTP-Response (fuer Logs). */
  status: number;
  /** Fehler-Text bei !ok (fuer Logs). */
  error?: string;
}

export async function createAnnyBooking(
  input: CreateAnnyBookingInput,
): Promise<CreateAnnyBookingResult> {
  const {
    baseUrl,
    token,
    serviceUuid,
    resourceUuid,
    startIso,
    endIso,
    description,
    notifyCustomer = false,
    checkAvailability = true,
    organizationId,
    quantity = 1,
  } = input;

  const qty = Math.max(1, Math.floor(quantity));
  const payload = {
    bookings: [
      {
        resource_id: resourceUuid,
        service_id: { [serviceUuid]: qty },
        start_date: startIso,
        end_date: endIso,
        ...(qty > 1 ? { quantity: qty } : {}),
        ...(description ? { description } : {}),
      },
    ],
    notify_customer: notifyCustomer,
    complete_order: true,
    check_availability: checkAvailability,
    timezone: "Europe/Berlin",
  };

  const url = organizationId
    ? `${baseUrl}/api/v1/orders/from-config?o=${encodeURIComponent(organizationId)}`
    : `${baseUrl}/api/v1/orders/from-config`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.api+json, application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    const status = res.status;
    if (!res.ok) {
      let errText = "";
      try {
        const body = await res.text();
        errText = body.slice(0, 500);
      } catch { /* ignore */ }
      return { bookingId: null, bookingIds: [], orderId: null, ok: false, status, error: errText };
    }
    const json = (await res.json()) as {
      data?: {
        id?: string;
        relationships?: { bookings?: { data?: Array<{ id?: string }> } };
      };
    };
    const orderId = json?.data?.id ?? null;
    const bookingIds = (json?.data?.relationships?.bookings?.data ?? [])
      .map((b) => b?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const bookingId = bookingIds[0] ?? null;
    return { bookingId, bookingIds, orderId, ok: true, status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { bookingId: null, bookingIds: [], orderId: null, ok: false, status: 0, error: msg };
  }
}

/**
 * Storniert eine ANNY-Buchung. ANNY's Admin-API exponiert den Storno als
 * GET-Aufruf auf `/api/v1/bookings/{id}/cancel` (analog zu
 * `/orders/{id}/send-notification`). Wird beim Aufheben einer Slot-Sperre
 * fuer jede zuvor angelegte Platzhalter-Buchung aufgerufen, damit die
 * Kapazitaet in ANNY wieder frei wird.
 *
 * Liefert { ok: true } bei 2xx oder 404 (Buchung existiert nicht mehr ->
 * fuer den Aufruf-Zweck "weg" und damit ok). Sonst { ok: false, ... }.
 */
export async function cancelAnnyBooking(
  baseUrl: string,
  token: string,
  bookingId: string,
  organizationId?: string | null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const url = organizationId
    ? `${cleanBase}/api/v1/bookings/${bookingId}/cancel?o=${encodeURIComponent(organizationId)}`
    : `${cleanBase}/api/v1/bookings/${bookingId}/cancel`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.api+json, application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok || res.status === 404) return { ok: true };
    let errText = "";
    try {
      errText = (await res.text()).slice(0, 500);
    } catch { /* ignore */ }
    return { ok: false, status: res.status, error: errText || `ANNY ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, error: msg };
  }
}
