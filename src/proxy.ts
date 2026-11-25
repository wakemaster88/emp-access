import { NextResponse, type NextRequest } from "next/server";
import { RIDER_BASE_HEADER, parseRiderAlsPath } from "@/lib/rider-als";
import { RIDER_APP_HEADER, RIDER_REST_HEADER, beachToAppPath, riderRestOf } from "@/lib/rider-app-kind";
import { CROSS_SITE_HEADER, crossSiteWrite } from "@/lib/cross-site";

/**
 * Kunden-App, zwei Aufgaben:
 *
 * - Beach Pass: `/beach/…` ist dieselbe App wie `/app/…` mit eigenem Namen,
 *   Icon und Link (Aaron, 22.11.2026). Intern wird auf `/app/…` umgeschrieben,
 *   `x-rd-app: beach` sagt den Seiten, welche App gerade läuft.
 * - Familie: Andere Personen öffnen sich unter der Adresse der angemeldeten
 *   Person, `/app/<eigener Token>/als/<Token der Person>/…`. So bleibt der
 *   Wechsel im Bereich der installierten App; iOS öffnete `/app/<anderer
 *   Token>` sonst in einem eigenen Browserfenster (Aaron, 21.11.2026). Ob die
 *   angemeldete Person die Seiten sehen darf, prüfen die Seiten selbst.
 *
 * Unter /api nur eine Markierung: schreibende Anfragen einer fremden Seite
 * bekommen CROSS_SITE_HEADER (src/lib/cross-site.ts). Abgewiesen werden sie
 * erst beim Lesen der Sitzung; Token-Zugänge bleiben unberührt. Der Proxy
 * läuft dort nur, wenn der Browser die Anfrage selbst als fremd ausweist
 * (Sec-Fetch-Site same-site oder cross-site) oder – bei Browsern ohne diesen
 * Header – ein Origin mitschickt. Die eigenen Seiten (same-origin), Geräte
 * und Skripte gehen direkt durch, ohne Umweg über den Proxy.
 */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const apiHeaders = new Headers(request.headers);
    // Nie vom Absender übernehmen: nur der Proxy setzt die Markierung.
    apiHeaders.delete(CROSS_SITE_HEADER);
    if (crossSiteWrite(request.method, request.headers)) apiHeaders.set(CROSS_SITE_HEADER, "1");
    return NextResponse.next({ request: { headers: apiHeaders } });
  }

  const headers = new Headers(request.headers);
  // Nie vom Gerät übernehmen: nur der Proxy setzt diese Werte.
  headers.delete(RIDER_BASE_HEADER);
  headers.delete(RIDER_APP_HEADER);
  headers.delete(RIDER_REST_HEADER);

  const pathname = request.nextUrl.pathname;
  const fromBeach = beachToAppPath(pathname);
  const path = fromBeach ?? pathname;
  if (fromBeach) headers.set(RIDER_APP_HEADER, "beach");
  headers.set(RIDER_REST_HEADER, riderRestOf(path));

  const als = parseRiderAlsPath(path);
  if (als) headers.set(RIDER_BASE_HEADER, fromBeach ? `/beach${als.base.slice(4)}` : als.base);
  if (!als && !fromBeach) return NextResponse.next({ request: { headers } });

  const url = request.nextUrl.clone();
  url.pathname = als ? als.target : path;
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  matcher: [
    "/app",
    "/app/:path*",
    "/beach",
    "/beach/:path*",
    { source: "/api/:path*", has: [{ type: "header", key: "sec-fetch-site", value: "(same-site|cross-site)" }] },
    {
      source: "/api/:path*",
      has: [{ type: "header", key: "origin" }],
      missing: [{ type: "header", key: "sec-fetch-site" }],
    },
  ],
};
