import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";

/**
 * Symmetrische Verschluesselung fuer Geheimnisse, die in der Datenbank liegen
 * muessen, aber dort nicht im Klartext stehen sollen – aktuell die TOTP-Secrets
 * der Admins. Ein Datenbank-Dump allein reicht damit nicht aus, um fremde
 * Einmalcodes zu erzeugen; zusaetzlich wird der Anwendungsschluessel gebraucht.
 *
 * Schluessel ist TWO_FACTOR_KEY, ersatzweise AUTH_SECRET. Wird der Schluessel
 * getauscht, sind bestehende Secrets nicht mehr lesbar – die betroffenen
 * Admins muessen ihre 2FA neu einrichten (Reset ueber den SUPER_ADMIN oder
 * scripts/reset-2fa.ts).
 */

const VERSION = "v1";
const KEY_INFO = "emp-access/secret-box";

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const material = process.env.TWO_FACTOR_KEY || process.env.AUTH_SECRET;
  if (!material) {
    throw new Error("AUTH_SECRET (oder TWO_FACTOR_KEY) fehlt – Secrets koennen nicht verschluesselt werden");
  }
  // scrypt ist bewusst langsam; das Ergebnis wird pro Prozess gecacht.
  cachedKey = scryptSync(material, KEY_INFO, 32);
  return cachedKey;
}

/** Nur fuer Tests: erzwingt ein erneutes Ableiten des Schluessels. */
export function _resetSecretBoxKey() {
  cachedKey = null;
}

/**
 * Nicht umkehrbarer Abdruck eines zufaelligen Werts – gedacht fuer Tokens mit
 * hoher Entropie (Wiederherstellungscodes), nicht fuer Passwoerter. Der
 * Anwendungsschluessel geht mit ein, damit die Hashes ohne ihn nicht einmal
 * gegen eine Wortliste geprueft werden koennen.
 */
export function keyedFingerprint(namespace: string, value: string): string {
  return createHmac("sha256", key()).update(`${namespace}:${value}`).digest("base64url");
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

/** Gibt null zurueck, wenn der Wert nicht (mehr) entschluesselbar ist. */
export function openSecret(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const enc = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
