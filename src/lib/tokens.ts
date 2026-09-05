import { randomBytes } from "node:crypto";

/**
 * Zufaellige Zugangstoken. Frueher kamen Monitor- und Account-Token aus
 * Prismas `cuid()`, das zeitbasiert und nur zum Teil zufaellig ist. Alles,
 * was als Bearer-Geheimnis dient, kommt jetzt aus dem CSPRNG.
 */

/** Account-API-Token (Hub, Integrationen): 64 Hex-Zeichen. */
export function newAccountApiToken(): string {
  return randomBytes(32).toString("hex");
}

/** Geraete-Token fuer Scanner- und Audio-Pis, nur fuer die Geraete-Endpunkte gueltig. */
export function newDeviceApiToken(): string {
  return `dev_${randomBytes(24).toString("base64url")}`;
}

/** Token in oeffentlichen URLs (Monitor, Kiosk, Scanner-Seite). */
export function newPublicToken(): string {
  return randomBytes(24).toString("base64url");
}
