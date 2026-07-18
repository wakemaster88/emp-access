/**
 * Minimaler OUI-Lookup (MAC-Prefix -> Hersteller) fuer die im Betrieb
 * relevanten Marken. Bewusst kuratiert statt vollstaendiger IEEE-Datenbank:
 * hilft beim Identifizieren entdeckter Geraete, ohne 40k Eintraege zu laden.
 * Unbekannte Prefixe liefern null (UI zeigt dann "–").
 */
const OUI_MAP: Record<string, string> = {
  // NETGEAR (Switches, Access Points, Router vor Ort)
  "14:59:C0": "NETGEAR",
  "28:80:88": "NETGEAR",
  "94:18:65": "NETGEAR",
  "54:07:7D": "NETGEAR",
  "10:DA:43": "NETGEAR",
  "8C:3B:AD": "NETGEAR",
  // Raspberry Pi (Zutritts-Controller)
  "B8:27:EB": "Raspberry Pi",
  "DC:A6:32": "Raspberry Pi",
  "E4:5F:01": "Raspberry Pi",
  "D8:3A:DD": "Raspberry Pi",
  "28:CD:C1": "Raspberry Pi",
  "2C:CF:67": "Raspberry Pi",
  // Espressif (ESP-Chips: Shelly, viele IoT-Geraete)
  "24:0A:C4": "Espressif (IoT/Shelly)",
  "30:AE:A4": "Espressif (IoT/Shelly)",
  "84:CC:A8": "Espressif (IoT/Shelly)",
  "A4:CF:12": "Espressif (IoT/Shelly)",
  "EC:FA:BC": "Espressif (IoT/Shelly)",
  "C4:5B:BE": "Espressif (IoT/Shelly)",
  "3C:61:05": "Espressif (IoT/Shelly)",
  "40:91:51": "Espressif (IoT/Shelly)",
  "48:3F:DA": "Espressif (IoT/Shelly)",
  "68:C6:3A": "Espressif (IoT/Shelly)",
  "7C:DF:A1": "Espressif (IoT/Shelly)",
  "8C:AA:B5": "Espressif (IoT/Shelly)",
  "98:CD:AC": "Espressif (IoT/Shelly)",
  "BC:DD:C2": "Espressif (IoT/Shelly)",
  "CC:50:E3": "Espressif (IoT/Shelly)",
  "D8:BF:C0": "Espressif (IoT/Shelly)",
  "E8:DB:84": "Espressif (IoT/Shelly)",
};

export function macVendor(mac: string): string | null {
  const prefix = mac.toUpperCase().slice(0, 8);
  return OUI_MAP[prefix] ?? null;
}

/** Multicast-/Broadcast-MACs sind keine echten Geraete (mDNS, IPv6-ND, ...). */
export function isVirtualMac(mac: string): boolean {
  const m = mac.toUpperCase();
  if (m === "FF:FF:FF:FF:FF:FF") return true;
  if (m.startsWith("01:00:5E")) return true; // IPv4-Multicast
  if (m.startsWith("33:33")) return true; // IPv6-Multicast
  // Multicast-Bit im ersten Oktett gesetzt
  const first = parseInt(m.slice(0, 2), 16);
  return Number.isFinite(first) && (first & 0x01) === 1;
}
