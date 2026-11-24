/**
 * Adressen, die der Hub in go2rtc.yaml und config.json einsetzt: nur IPv4
 * oder ein Hostname aus Buchstaben, Ziffern, Punkten und Bindestrichen –
 * ohne Schema, Port, Pfad oder Zugangsdaten. Gleiche Regel wie in der Cloud
 * (src/lib/net-address.ts); der Hub hat eine eigene Kopie.
 */

// Nur die übliche Schreibweise ohne führende Nullen ("010" wäre für
// URL-Parser eine Oktalzahl).
const OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4_RE = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);
const HOSTNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

export function isStreamHost(value: string): boolean {
  if (IPV4_RE.test(value)) return true;
  // Nur Ziffern und Punkte, aber keine gültige IPv4.
  if (/^[\d.]+$/.test(value)) return false;
  return HOSTNAME_RE.test(value);
}

/**
 * Alte Adresse in einem Konfigurationstext durch die neue ersetzen. Eine
 * IPv4 wird gegen angrenzende Ziffern und Punkte abgegrenzt, ein Hostname
 * zusätzlich gegen Buchstaben und Bindestriche, damit z. B. "cam" nicht in
 * "cams" oder "cam.local" ersetzt wird.
 */
export function replaceHost(text: string, oldHost: string, newHost: string): { text: string; count: number } {
  const escaped = oldHost.replace(/[.\-]/g, "\\$&");
  const re = IPV4_RE.test(oldHost)
    ? new RegExp(`(?<![\\d.])${escaped}(?![\\d])`, "g")
    : new RegExp(`(?<![A-Za-z0-9.-])${escaped}(?![A-Za-z0-9.-])`, "g");
  let count = 0;
  const replaced = text.replace(re, () => {
    count++;
    return newHost;
  });
  return { text: replaced, count };
}
