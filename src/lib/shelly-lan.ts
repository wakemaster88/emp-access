/**
 * Auf Vercel ist die hinterlegte LAN-Adresse eines Shelly nie erreichbar: ein
 * lokaler Versuch wartet dort nur bis zum Timeout. Wo es einen Cloud-Weg gibt,
 * wird der lokale Versuch deshalb uebersprungen. Ausserhalb von Vercel (Hub,
 * lokale Entwicklung) bleibt es bei "lokal zuerst".
 */
export function lanUnreachable(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.VERCEL);
}
