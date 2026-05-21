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
}

export interface CreateAnnyBookingResult {
  /** UUID der angelegten Booking (NICHT der Order) - fuer spaeteren Storno. */
  bookingId: string | null;
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
  } = input;

  const payload = {
    bookings: [
      {
        resource_id: resourceUuid,
        service_id: { [serviceUuid]: 1 },
        start_date: startIso,
        end_date: endIso,
        ...(description ? { description } : {}),
      },
    ],
    notify_customer: notifyCustomer,
    complete_order: true,
    check_availability: checkAvailability,
    timezone: "Europe/Berlin",
  };

  try {
    const res = await fetch(`${baseUrl}/api/v1/orders/from-config`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
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
      return { bookingId: null, orderId: null, ok: false, status, error: errText };
    }
    const json = (await res.json()) as {
      data?: {
        id?: string;
        relationships?: { bookings?: { data?: Array<{ id?: string }> } };
      };
    };
    const orderId = json?.data?.id ?? null;
    const bookingId = json?.data?.relationships?.bookings?.data?.[0]?.id ?? null;
    return { bookingId, orderId, ok: true, status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { bookingId: null, orderId: null, ok: false, status: 0, error: msg };
  }
}
