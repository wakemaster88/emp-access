import { headers } from "next/headers";
import { riderAppPath } from "@/lib/rider-app";
import { RIDER_BASE_HEADER, parseRiderAlsPath } from "@/lib/rider-als";

/**
 * Link-Basis einer Seite der Kunden-App: normal `/app/<token>`; zeigt die Seite
 * eine andere Person der Familie, `/app/<eigener Token>/als/<token>`, damit
 * alle Links im Bereich der installierten App bleiben (src/proxy.ts).
 */
export async function riderBase(token: string): Promise<string> {
  const value = (await headers()).get(RIDER_BASE_HEADER);
  const als = value ? parseRiderAlsPath(value) : null;
  return als && als.person === token ? als.base : riderAppPath(token);
}
