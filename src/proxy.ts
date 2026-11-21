import { NextResponse, type NextRequest } from "next/server";
import { RIDER_BASE_HEADER, parseRiderAlsPath } from "@/lib/rider-als";

/**
 * Familie in der Kunden-App: Andere Personen öffnen sich unter der Adresse der
 * angemeldeten Person, `/app/<eigener Token>/als/<Token der Person>/…`. So
 * bleibt der Wechsel im Bereich der installierten App; iOS öffnete
 * `/app/<anderer Token>` sonst in einem eigenen Browserfenster, weil ältere
 * Installationen nur `/app/<eigener Token>` als App kennen (Aaron, 21.11.2026).
 * Intern wird auf die Seiten der Person umgeschrieben; ob die angemeldete
 * Person sie sehen darf, prüfen die Seiten wie bisher selbst.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Nie vom Gerät übernehmen: nur der Proxy setzt die Link-Basis.
  headers.delete(RIDER_BASE_HEADER);
  const als = parseRiderAlsPath(request.nextUrl.pathname);
  if (!als) return NextResponse.next({ request: { headers } });
  headers.set(RIDER_BASE_HEADER, als.base);
  const url = request.nextUrl.clone();
  url.pathname = als.target;
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  matcher: ["/app/:path*"],
};
