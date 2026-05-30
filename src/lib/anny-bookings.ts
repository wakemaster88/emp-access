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
        // ANNY ist JSON:API: Schreib-Requests MUESSEN application/vnd.api+json
        // sein, sonst antwortet die API mit 415 (Unsupported Media Type).
        // Standard application/json wird fuer POST/PATCH nicht akzeptiert.
        "Content-Type": "application/vnd.api+json",
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
 * Legt eine echte ANNY-Buchung an - der korrekte Weg fuer Schalter-Verkaeufe.
 *
 * WICHTIG: `POST /orders/from-config` (createAnnyBooking) crasht fuer diesen
 * Account durchgaengig mit 500 (auch /orders/calculate). Die Admin-UI legt
 * Buchungen stattdessen ueber `POST /api/v1/bookings` an - das funktioniert
 * und reduziert die ANNY-Kapazitaet korrekt.
 *
 * Payload (JSON:API) - es MUESSEN sowohl `attributes.service_id` (Map
 * service->Menge) als auch `relationships.service` UND `relationships.resource`
 * gesetzt sein, sonst antwortet ANNY mit 500.
 */
export async function createAnnyBookingV2(
  input: CreateAnnyBookingInput,
): Promise<CreateAnnyBookingResult> {
  const { baseUrl, token, serviceUuid, resourceUuid, startIso, endIso, description, organizationId, quantity = 1 } = input;
  const qty = Math.max(1, Math.floor(quantity));
  const payload = {
    data: {
      type: "bookings",
      attributes: {
        start_date: startIso,
        end_date: endIso,
        service_id: { [serviceUuid]: qty },
        ...(description ? { description } : {}),
      },
      relationships: {
        resource: { data: { type: "resources", id: String(resourceUuid) } },
        service: { data: { type: "services", id: String(serviceUuid) } },
      },
    },
  };
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const url = organizationId
    ? `${cleanBase}/api/v1/bookings?o=${encodeURIComponent(organizationId)}`
    : `${cleanBase}/api/v1/bookings`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json, application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    const status = res.status;
    if (!res.ok) {
      let errText = "";
      try { errText = (await res.text()).slice(0, 500); } catch { /* ignore */ }
      return { bookingId: null, bookingIds: [], orderId: null, ok: false, status, error: errText };
    }
    const json = (await res.json()) as { data?: { id?: string } };
    const bookingId = json?.data?.id ?? null;
    return { bookingId, bookingIds: bookingId ? [bookingId] : [], orderId: null, ok: true, status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { bookingId: null, bookingIds: [], orderId: null, ok: false, status: 0, error: msg };
  }
}

export interface CreateAnnyBlockerInput {
  baseUrl: string;
  token: string;
  /** ANNY-Resource-UUID, die gesperrt werden soll (z.B. Seilbahn B). */
  resourceUuid: string;
  startIso: string;
  endIso: string;
  /** Titel des Blockers (im ANNY-Kalender sichtbar). */
  title?: string;
  organizationId?: string | null;
}

export interface CreateAnnyBlockerResult {
  /** UUID/ID des angelegten Blocker-Bookings (fuer spaeteres Loeschen). */
  blockerId: string | null;
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * Legt in ANNY einen nativen "Blocker" an, um einen Zeitraum auf einer
 * Resource fuer Buchungen zu sperren (genau das, was im ANNY-Kalender ueber
 * "Blocker erstellen" passiert).
 *
 * WICHTIG: ANNY's `POST /orders/from-config` (Platzhalter-Buchung) ist hier
 * der FALSCHE Weg - das erzeugt eine bezahlpflichtige Order und ANNY
 * antwortet fuer diesen Account durchgaengig mit 500. Blocker werden
 * stattdessen als spezielle Buchung ueber `POST /api/v1/bookings` mit
 * `is_blocker: true` angelegt - ohne Service/Kunde/Preis.
 *
 * Payload (JSON:API):
 *   { data: { type: "bookings",
 *             attributes: { start_date, end_date, is_blocker: true, title },
 *             relationships: { resource: { data: { type: "resources", id } } } } }
 */
export async function createAnnyBlocker(
  input: CreateAnnyBlockerInput,
): Promise<CreateAnnyBlockerResult> {
  const { baseUrl, token, resourceUuid, startIso, endIso, title, organizationId } = input;
  const payload = {
    data: {
      type: "bookings",
      attributes: {
        start_date: startIso,
        end_date: endIso,
        is_blocker: true,
        ...(title ? { title } : {}),
      },
      relationships: {
        resource: { data: { type: "resources", id: String(resourceUuid) } },
      },
    },
  };
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const url = organizationId
    ? `${cleanBase}/api/v1/bookings?o=${encodeURIComponent(organizationId)}`
    : `${cleanBase}/api/v1/bookings`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json, application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    const status = res.status;
    if (!res.ok) {
      let errText = "";
      try { errText = (await res.text()).slice(0, 500); } catch { /* ignore */ }
      return { blockerId: null, ok: false, status, error: errText };
    }
    const json = (await res.json()) as { data?: { id?: string } };
    return { blockerId: json?.data?.id ?? null, ok: true, status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { blockerId: null, ok: false, status: 0, error: msg };
  }
}

/**
 * Loescht eine ANNY-Buchung (inkl. Blocker) hart ueber
 * `DELETE /api/v1/bookings/{id}`. Liefert ok bei 2xx oder 404 (existiert
 * nicht mehr -> Ziel erreicht). Wird beim Aufheben einer Slot-Sperre genutzt.
 */
export async function deleteAnnyBooking(
  baseUrl: string,
  token: string,
  bookingId: string,
  organizationId?: string | null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const url = organizationId
    ? `${cleanBase}/api/v1/bookings/${bookingId}?o=${encodeURIComponent(organizationId)}`
    : `${cleanBase}/api/v1/bookings/${bookingId}`;
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.api+json, application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok || res.status === 404) return { ok: true };
    let errText = "";
    try { errText = (await res.text()).slice(0, 500); } catch { /* ignore */ }
    return { ok: false, status: res.status, error: errText || `ANNY ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, error: msg };
  }
}

/**
 * Prueft, ob eine ANNY-Buchung noch existiert (`GET /api/v1/bookings/{id}`).
 * Liefert false bei 404 (weg), true bei 2xx (existiert noch), null wenn
 * unklar (Netzwerk/anderer Status). Dient als autoritative Absicherung beim
 * Aufheben einer Sperre: ist die Buchung weg, gilt das Storno als erfolgreich.
 */
export async function annyBookingExists(
  baseUrl: string,
  token: string,
  bookingId: string,
  organizationId?: string | null,
): Promise<boolean | null> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const url = organizationId
    ? `${cleanBase}/api/v1/bookings/${bookingId}?o=${encodeURIComponent(organizationId)}`
    : `${cleanBase}/api/v1/bookings/${bookingId}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.api+json, application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) return false;
    if (res.ok) return true;
    return null;
  } catch {
    return null;
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
