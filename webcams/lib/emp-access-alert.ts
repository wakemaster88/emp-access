import { loadConfig } from "./config";
import { empAccessPostJson } from "./emp-access-client";

/**
 * Meldet einen Vorfall an emp-access, damit er als Popup auf dem
 * Kassen-Monitor im Shop erscheint.
 *
 * Der Weg über die Cloud statt direkt auf den Bildschirm ist Absicht: Der
 * Monitor hängt an einer Token-URL und pollt ohnehin; ein Gerät im Shop
 * müssten wir sonst kennen, erreichen und am Leben halten.
 */

export interface ShopAlertImage {
  /** Woher das Bild stammt, erscheint als Unterschrift. */
  label: string;
  jpeg: Buffer;
}

export interface ShopAlert {
  camName: string;
  /** Wie viele ungedeckte Durchgänge gemeldet werden. */
  count: number;
  crossedAt: number;
  /** Blickwinkel zum Vorfall — ohne Bild ist die Meldung an der Kasse wenig wert. */
  images?: ShopAlertImage[];
}

function buildMessage(a: ShopAlert): string {
  const zeit = new Date(a.crossedAt).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const wer =
    a.count === 1
      ? "Eine Person ist"
      : `${a.count} Personen sind`;
  return `${wer} um ${zeit} ohne gültigen Scan durch das Drehkreuz gegangen (${a.camName}).`;
}

export async function postShopAlert(alert: ShopAlert): Promise<void> {
  const cfg = await loadConfig();
  const emp = cfg.settings.empAccess;
  const token = emp.apiToken?.trim() ?? "";
  if (!emp.enabled || !token) return;

  await empAccessPostJson(emp.baseUrl, token, "/api/monitor/alerts", {
    kind: "TAILGATE",
    message: buildMessage(alert),
    source: alert.camName,
    occurredAt: new Date(alert.crossedAt).toISOString(),
    images: (alert.images ?? []).map((i) => ({
      label: i.label,
      data: i.jpeg.toString("base64"),
    })),
  });
}
