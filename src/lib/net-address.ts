/**
 * Prüfungen für Netzwerkadressen, die Admins an Kameras und Geräten
 * eintragen. Gespeichert wird nur die reine Adresse – ohne Schema, Pfad,
 * Port oder Zugangsdaten –, weil Cloud und Hub sie selbst in URLs und
 * Konfigurationsdateien einsetzen.
 */

// Nur die übliche Schreibweise ohne führende Nullen: URL-Parser lesen
// "010" als Oktalzahl, die Prüfung hier würde es dezimal lesen.
const OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4_RE = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);
const HOSTNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

function ipv4Octets(value: string): number[] | null {
  const m = IPV4_RE.exec(value);
  if (!m) return null;
  return m.slice(1).map(Number);
}

/** IPv4-Adresse in Punktschreibweise ohne führende Nullen (z. B. "192.168.1.20"). */
export function isIpv4(value: string): boolean {
  return ipv4Octets(value) !== null;
}

/** IPv4-Adresse oder Hostname aus Buchstaben, Ziffern, Punkten und Bindestrichen. */
export function isHostAddress(value: string): boolean {
  if (isIpv4(value)) return true;
  // Nur Ziffern und Punkte, aber keine gültige IPv4 (z. B. "300.1.1.1" oder "010.1.2.3").
  if (/^[\d.]+$/.test(value)) return false;
  return HOSTNAME_RE.test(value);
}

export const INVALID_HOST_ERROR =
  "Ungültiger Host – bitte nur die IP-Adresse oder den Hostnamen eintragen (ohne http://, Port, Pfad oder Zugangsdaten)";

/** IPv4 aus einem privaten Netz (10/8, 172.16/12, 192.168/16, 169.254/16). */
export function isPrivateIpv4(value: string): boolean {
  const o = ipv4Octets(value);
  if (!o) return false;
  return (
    o[0] === 10 ||
    (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
    (o[0] === 192 && o[1] === 168) ||
    (o[0] === 169 && o[1] === 254)
  );
}

export interface CameraAddress {
  host: string;
  httpPort: number;
  https: boolean;
}

/**
 * Ändert sich die Adresse einer Kamera (Host, Port oder https) auf ein Ziel
 * außerhalb der privaten IPv4-Netze, wird das gespeicherte Passwort nicht
 * weiterverwendet – das Passwort muss dann neu eingegeben werden. Ein
 * Wechsel auf eine andere private IPv4 (neue LAN-Adresse) behält es.
 */
export function addressChangeNeedsPassword(before: CameraAddress, after: CameraAddress): boolean {
  const changed =
    before.host !== after.host || before.httpPort !== after.httpPort || before.https !== after.https;
  return changed && !isPrivateIpv4(after.host);
}

export const PASSWORD_REQUIRED_ERROR =
  "Die neue Kamera-Adresse liegt außerhalb des lokalen Netzes. Bitte das Kamera-Passwort neu eingeben.";

/**
 * Geräte-IP aus einem Request: leer/null bleibt erlaubt wie bisher, sonst nur
 * IPv4. Liefert die getrimmte Adresse, null für leer, oder einen Fehlertext.
 */
export function parseDeviceIp(value: unknown): { ip: string | null } | { error: string } {
  if (value === null || value === undefined) return { ip: null };
  if (typeof value !== "string") return { error: "Ungültige IP-Adresse" };
  const ip = value.trim();
  if (!ip) return { ip: null };
  if (!isIpv4(ip)) return { error: "Ungültige IP-Adresse – bitte eine IPv4-Adresse wie 192.168.1.20 eintragen" };
  return { ip };
}

/** Höchstlänge für den Namen, unter dem ein Abspieler per AirPlay/Bluetooth erscheint. */
export const MAX_RECEIVER_NAME = 60;

/** Höchstlänge für Zonennamen. */
export const MAX_ZONE_NAME = 100;

/**
 * Name für Abspieler-Konfigurationen: entfernt Anführungszeichen, Backslash
 * und Steuerzeichen (inkl. Zeilenumbrüche) und kürzt auf `max` Zeichen.
 * Umlaute, "&", Klammern usw. bleiben stehen.
 */
export function cleanReceiverName(value: string, max = MAX_RECEIVER_NAME): string {
  return value.replace(/["\\\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, "").trim().slice(0, max).trim();
}
