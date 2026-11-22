import { headers } from "next/headers";
import { RIDER_BASE_HEADER, parseRiderAlsPath } from "@/lib/rider-als";
import { APP_PREFIX, RIDER_APP_HEADER, RIDER_REST_HEADER, type RiderAppKind } from "@/lib/rider-app-kind";

/** Welche App gerade läuft: Ride Pass (`/app`) oder Beach Pass (`/beach`), vom Proxy gesetzt. */
export async function riderAppKind(): Promise<RiderAppKind> {
  return (await headers()).get(RIDER_APP_HEADER) === "beach" ? "beach" : "ride";
}

/** Pfad nach dem Token der aufgerufenen Seite (`/awards/3`), vom Proxy gesetzt. */
export async function riderRest(): Promise<string> {
  return (await headers()).get(RIDER_REST_HEADER) ?? "";
}

/** Startseite einer Person in der laufenden App, `/app/<token>` oder `/beach/<token>`. */
export async function riderHome(token: string): Promise<string> {
  return `${APP_PREFIX[await riderAppKind()]}/${encodeURIComponent(token)}`;
}

/**
 * Link-Basis einer Seite der Kunden-App: normal `/app/<token>` (bzw.
 * `/beach/<token>`); zeigt die Seite eine andere Person der Familie,
 * `/app/<eigener Token>/als/<token>`, damit alle Links im Bereich der
 * installierten App bleiben (src/proxy.ts).
 */
export async function riderBase(token: string): Promise<string> {
  const h = await headers();
  const value = h.get(RIDER_BASE_HEADER);
  const als = value ? parseRiderAlsPath(value.replace(/^\/beach\//, "/app/")) : null;
  return als && als.person === token ? value! : riderHome(token);
}
