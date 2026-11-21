/**
 * Adressen der Familien-Ansicht in der Kunden-App:
 * `/app/<eigener Token>/als/<Token der Person>/…` zeigt die Seiten der Person
 * (siehe src/proxy.ts). Ohne Prisma, darf überall importiert werden.
 */

export const RIDER_BASE_HEADER = "x-rd-base";

const TOKEN = "[A-Za-z0-9_-]{16,64}";
const ALS_RE = new RegExp(`^/app/(${TOKEN})/als/(${TOKEN})(/.*)?$`);
// Diese Teile gehören zur angemeldeten Person selbst, nicht zur angezeigten.
const OWN_ONLY = /^\/(anmelden|einrichten|neu|manifest\.webmanifest)(\/|$)/;

export interface RiderAlsPath {
  viewer: string;
  person: string;
  /** Link-Basis für die Seiten der Person, z. B. `/app/<eigener>/als/<Person>`. */
  base: string;
  /** Interner Pfad, `/app/<Person>/…`. */
  target: string;
}

export function parseRiderAlsPath(pathname: string): RiderAlsPath | null {
  const m = ALS_RE.exec(pathname);
  if (!m) return null;
  const [, viewer, person, rest = ""] = m;
  if (viewer === person || OWN_ONLY.test(rest)) return null;
  return { viewer, person, base: `/app/${viewer}/als/${person}`, target: `/app/${person}${rest}` };
}

/** Link zur Startseite einer Person der Familie, aus Sicht der angemeldeten Person. */
export function riderAlsPath(viewerToken: string, personToken: string): string {
  const own = `/app/${encodeURIComponent(viewerToken)}`;
  return viewerToken === personToken ? own : `${own}/als/${encodeURIComponent(personToken)}`;
}
