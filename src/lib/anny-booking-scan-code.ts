/**
 * ANNY liefert den QR-/Ticket-Code oft nicht in `number`, sondern in eigenen Feldern
 * (z. B. "!TIXJQLjnVdgH288QWjb"). Diese Werte in `barcode` speichern, damit Scanner & Gate matchen.
 */

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (isNonEmptyString(v)) return v.trim();
  }
  return null;
}

/** Heuristik: typische maschinenlesbare Ticket-Codes von ANNY */
function looksLikeAnnyTicketToken(s: string): boolean {
  const t = s.trim();
  if (t.startsWith("!")) return true;
  if (/^TIX[A-Za-z0-9_-]+$/i.test(t)) return true;
  if (t.length >= 16 && /^[A-Za-z0-9!_-]+$/.test(t)) return true;
  return false;
}

/** Flacht JSON:API-artige Objekte zu einem Feld-Record. */
function flattenBookingLike(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const b = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...b };

  const attrs = b.attributes;
  if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
    Object.assign(out, attrs as Record<string, unknown>);
  }

  return out;
}

function nestedTicketCode(src: Record<string, unknown>): string | null {
  const ticket = src.ticket;
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) return null;
  const t = ticket as Record<string, unknown>;
  return pickString(
    t.code,
    t.token,
    t.qr_code,
    t.qrCode,
    t.ticket_code,
    t.ticketCode,
    t.number,
  );
}

/**
 * Liefert den Code, den Gäste am Scanner vorhalten (QR-Inhalt), sofern in der Payload erkennbar.
 */
export function extractAnnyBookingScanCode(raw: unknown): string | null {
  const src = flattenBookingLike(raw);

  const meta = src.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const m = meta as Record<string, unknown>;
    const fromMeta = pickString(
      m.ticket_code,
      m.ticketCode,
      m.qr_code,
      m.qrCode,
      m.booking_token,
      m.bookingToken,
    );
    if (fromMeta) return fromMeta;
  }

  // Explizite Ticket-/QR-Felder (Reihenfolge: spezifisch → allgemein)
  const direct = pickString(
    src.ticket_code,
    src.ticketCode,
    src.qr_code,
    src.qrCode,
    src.booking_token,
    src.bookingToken,
    src.pass_code,
    src.passCode,
    src.scan_code,
    src.scanCode,
    src.access_code,
    src.accessCode,
    src.checkin_code,
    src.checkinCode,
  );
  if (direct) return direct;

  const fromTicket = nestedTicketCode(src);
  if (fromTicket) return fromTicket;

  // `token` nur wenn es wie Ticket-Code aussieht (kein langer JWT)
  const token = pickString(src.token);
  if (token && token.length < 200 && looksLikeAnnyTicketToken(token)) return token;

  // Manche APIs legen den Code in einer URL ab
  const url = pickString(src.ticket_url, src.ticketUrl, src.qr_url, src.qrUrl);
  if (url) {
    try {
      const path = new URL(url, "https://dummy.invalid").pathname;
      const seg = path.split("/").filter(Boolean).pop();
      if (seg && looksLikeAnnyTicketToken(decodeURIComponent(seg))) {
        return decodeURIComponent(seg);
      }
    } catch {
      /* ignore */
    }
  }

  const num = pickString(src.number);
  if (num && looksLikeAnnyTicketToken(num)) return num;

  return null;
}

/**
 * Bevorzugt den extrahierten Scan-Code, sonst `number` (menschliche Buchungsnr.).
 */
export function annyBarcodeForTicket(raw: unknown, bookingNumber: string | null | undefined): string | null {
  const scan = extractAnnyBookingScanCode(raw);
  if (scan) return scan;
  return isNonEmptyString(bookingNumber) ? bookingNumber.trim() : null;
}
