/**
 * Schutz schreibender Sitzungs-Anfragen gegen fremde Webseiten.
 *
 * Der Proxy (src/proxy.ts) kennt die Methode und markiert eine Anfrage unter
 * /api mit CROSS_SITE_HEADER, wenn sie nach crossSiteWrite() von einer
 * fremden Seite kommt. Abgewiesen wird erst dort, wo die Sitzung gelesen wird:
 * getSessionWithDb (src/lib/api-auth.ts) und safeAuth (src/lib/auth.ts), beide
 * ueber markedCrossSite() in auth.ts – also nur, wenn die Route sich ueber
 * das Sitzungs-Cookie anmeldet. API-Token, Geraete-Token, Monitor-Links,
 * Kunden-App und Webhooks bleiben unberuehrt.
 */

/** Setzt nur der Proxy; ein mitgeschickter Wert wird dort immer entfernt. */
export const CROSS_SITE_HEADER = "x-emp-cross-site";

function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * true, wenn eine nicht lesende Anfrage (alles ausser GET/HEAD) laut Browser
 * von einer fremden Seite stammt:
 *
 * - Sec-Fetch-Site vorhanden und weder `same-origin` noch `none`, oder
 * - ohne Sec-Fetch-Site: Origin vorhanden und dessen Host weicht vom Host der
 *   Anfrage ab.
 *
 * Ohne beide Header (Skripte, Geraete, Server) gilt die Anfrage als unbedenklich.
 */
export function crossSiteWrite(method: string, headers: Headers): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return false;

  const fetchSite = headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite) return fetchSite !== "same-origin" && fetchSite !== "none";

  const origin = headers.get("origin")?.trim();
  if (!origin) return false;
  const requestHost = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  return hostOf(origin) !== requestHost;
}

