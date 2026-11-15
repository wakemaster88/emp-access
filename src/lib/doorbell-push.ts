/**
 * Web-Push, wenn an einer DoorBird geklingelt wird.
 *
 * Der Hub haelt die monitor.cgi-Verbindung zur DoorBird offen und meldet
 * „doorbell:H“ sofort als DOORBELL-Start an /api/hub/camera-events. Dort
 * geht die Push raus, noch bevor der Schnappschuss fertig ist: bei einer
 * Klingel zaehlt jede Sekunde. Das Bild und der Oeffnen-Knopf liegen auf der
 * Zielseite (Livebild der DoorBird).
 *
 * An der DoorBird selbst muss dafuer nichts eingerichtet werden (kein
 * HTTP-Favorit, kein Webhook).
 */
import { sendPushToAccount, type PushPayload } from "./web-push";

/** Aeltere Klingel-Meldungen (z. B. nachgereicht nach Hub-Neustart) nicht mehr pushen. */
export const DOORBELL_PUSH_MAX_AGE_MS = 2 * 60_000;

/** Zielseite beim Antippen: Livebild der DoorBird mit Oeffnen-Knopf. */
export function doorbellPushUrl(cameraId: number): string {
  return `/?doorbird=${cameraId}`;
}

export function buildDoorbellPush(
  camera: { id: number; name: string },
  at: Date,
): PushPayload {
  const timeStr = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  return {
    title: "🔔 Es hat geklingelt",
    body: `${camera.name} · ${timeStr} Uhr · Tippen für Livebild und Öffnen`,
    url: doorbellPushUrl(camera.id),
    // Gleicher Tag: mehrmaliges Klingeln ersetzt die Meldung (mit erneutem Ton).
    tag: `doorbell-${camera.id}`,
    // Bleibt (wo unterstuetzt) sichtbar, bis jemand reagiert.
    requireInteraction: true,
  };
}

export function isFreshDoorbell(at: Date, now: Date = new Date()): boolean {
  return now.getTime() - at.getTime() <= DOORBELL_PUSH_MAX_AGE_MS;
}

/** Sendet die Klingel-Push; Fehler werden geloggt, nie geworfen. */
export async function sendDoorbellPush(
  accountId: number,
  camera: { id: number; name: string },
  at: Date,
): Promise<number> {
  if (!isFreshDoorbell(at)) return 0;
  try {
    const result = await sendPushToAccount(accountId, buildDoorbellPush(camera, at));
    return result.sent;
  } catch (err) {
    console.error("[doorbell-push] failed:", err);
    return 0;
  }
}
