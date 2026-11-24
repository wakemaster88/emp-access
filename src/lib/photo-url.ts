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
 * Groesstes Profilbild als Data-URL. Kamera und Upload verkleinern vorher
 * (Kasse 200-512 px, App 320 px, JPEG): solche Bilder liegen weit darunter.
 */
export const PROFILE_PHOTO_MAX_CHARS = 400_000;

/**
 * Gemeinsame Pruefung fuer Profilbilder aus dem Browser (Kunden-App, Kasse,
 * Backoffice, Scan-Monitor): nur JPG, PNG oder WebP als Base64-Data-URL und
 * hoechstens PROFILE_PHOTO_MAX_CHARS Zeichen. Null, wenn das Bild passt,
 * sonst ein Satz fuer die Anzeige.
 */
export function profilePhotoError(value: string): string | null {
  if (value.length > PROFILE_PHOTO_MAX_CHARS) return "Das Bild ist zu groß.";
  const decoded = decodeImageDataUrl(value);
  if (!decoded || decoded.contentType === "image/gif") return "Bitte ein Foto als JPG, PNG oder WebP wählen.";
  return null;
}

/**
 * Dieselbe Pruefung wie `profilePhotoError`, aber ohne `Buffer`, also auch im
 * Browser nutzbar: true, wenn der Server das Bild annimmt.
 */
export function profilePhotoAccepted(value: string): boolean {
  if (value.length > PROFILE_PHOTO_MAX_CHARS) return false;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(value.trim());
  return Boolean(match && match[2].replace(/[\s=]/g, "").length >= 2);
}

/**
 * Profilbild aus einem Formular, das ein bestehendes Ticket aendert.
 * Formulare schicken das angezeigte Foto mit, auch wenn niemand es angefasst
 * hat. Deshalb:
 * - Feld fehlt: nichts aendern (`{}`).
 * - leer/null: wie bisher durchreichen (Foto entfernen).
 * - derselbe Wert wie gespeichert: wie bisher durchreichen.
 * - eine Adresse statt eines Bildes (z. B. die Foto-URL aus einer Liste):
 *   nichts aendern, das gespeicherte Foto bleibt.
 * - ein neues Bild: muss `profilePhotoError` bestehen.
 */
export function profilePhotoUpdate(
  input: unknown,
  stored: string | null | undefined,
): { value?: string | null } | { error: string } {
  if (input === undefined) return {};
  if (input === null || input === "") return { value: input };
  if (typeof input !== "string") return { error: "Bitte ein Foto als JPG, PNG oder WebP wählen." };
  if (input === stored) return { value: input };
  if (!/^data:/i.test(input.trim())) return {};
  const error = profilePhotoError(input);
  return error ? { error } : { value: input };
}

/**
 * Hosts, auf die die Foto-Route eines Tickets weiterleitet, wenn statt eines
 * Bildes eine Adresse gespeichert ist: Fotos aus Wakesys (`<konto>.wakesys.com`).
 * Nur https. Der eigene Blob-Speicher ist privat und liefert keine Links aus.
 */
const PHOTO_REDIRECT_HOST_SUFFIXES = [".wakesys.com"];

export function isPhotoRedirectTarget(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PHOTO_REDIRECT_HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
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
