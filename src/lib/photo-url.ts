/**
 * Ticket-Fotos liegen als Data-URL (Base64) in `Ticket.profileImage`. In
 * Poll-Antworten werden sie durch eine URL ersetzt, damit der Kiosk nicht
 * alle paar Sekunden saemtliche Fotos des Tages neu laedt.
 */

/** URL der Foto-Route des Check-in-Monitors. `v` ist der Cache-Schluessel. */
export function checkinPhotoUrl(token: string, ticketId: number, updatedAt: Date): string {
  return `/api/checkin/public/${encodeURIComponent(token)}/photo/${ticketId}?v=${updatedAt.getTime()}`;
}

export type DecodedDataUrl = { contentType: string; bytes: Uint8Array };

/** Erlaubte Bildtypen; alles andere wird nicht als Bild ausgeliefert. */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Zerlegt eine Base64-Data-URL eines Bildes; null bei allem anderen. */
export function decodeImageDataUrl(value: string): DecodedDataUrl | null {
  const match = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value.trim());
  if (!match) return null;
  const contentType = match[1].toLowerCase();
  if (!IMAGE_TYPES.has(contentType)) return null;
  const bytes = new Uint8Array(Buffer.from(match[2], "base64"));
  if (bytes.length === 0) return null;
  return { contentType, bytes };
}

/**
 * Browser: macht aus einer Foto-Referenz wieder eine Data-URL. Wird
 * gebraucht, wenn ein Foto in ein neues Ticket uebernommen wird - der
 * Server erwartet dort das Bild selbst, nicht die URL eines anderen Tickets.
 */
export async function photoToDataUrl(src: string | null | undefined): Promise<string | undefined> {
  if (!src) return undefined;
  if (src.startsWith("data:")) return src;
  try {
    const res = await fetch(src);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}
