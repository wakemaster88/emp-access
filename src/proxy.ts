import { NextResponse, type NextRequest } from "next/server";
import { RIDER_BASE_HEADER, parseRiderAlsPath } from "@/lib/rider-als";
import { RIDER_APP_HEADER, RIDER_REST_HEADER, beachToAppPath, riderRestOf } from "@/lib/rider-app-kind";

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
 */
export function proxy(request: NextRequest) {
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
  matcher: ["/app", "/app/:path*", "/beach", "/beach/:path*"],
};
