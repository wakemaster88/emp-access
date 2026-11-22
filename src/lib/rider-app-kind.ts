/**
 * Zwei Apps, ein Code: Ride Pass unter `/app` und Beach Pass unter `/beach`
 * (Aaron, 22.11.2026: „Eigene App unter eigenem Link“). `/beach/…` schreibt
 * der Proxy intern auf `/app/…` um und setzt `x-rd-app: beach`; Links,
 * Manifest, Icon und Texte richten sich danach. Ohne Prisma, darf überall
 * importiert werden.
 */

export type RiderAppKind = "ride" | "beach";

/** Setzt nur der Proxy (src/proxy.ts); vom Gerät wird er nie übernommen. */
export const RIDER_APP_HEADER = "x-rd-app";
/** Pfad nach `/app/<token>` bzw. `/beach/<token>` (z. B. `/awards/3`), für Weiterleitungen in die andere App. */
export const RIDER_REST_HEADER = "x-rd-rest";

export const APP_PREFIX: Record<RiderAppKind, string> = { ride: "/app", beach: "/beach" };

export interface RiderAppBrand {
  name: string;
  /** Dateiname-Anfang der Icons unter /app-icons. */
  icon: string;
  description: string;
}

export const APP_BRAND: Record<RiderAppKind, RiderAppBrand> = {
  ride: { name: "Ride Pass", icon: "ride-pass", description: "Abo, Gutscheine und Statistik" },
  beach: { name: "Beach Pass", icon: "beach-pass", description: "Strand-Abo, Gutscheine und Strandtage" },
};

/** `/beach` und `/beach/…` → interner Pfad unter `/app`; sonst null. */
export function beachToAppPath(pathname: string): string | null {
  if (pathname === "/beach") return "/app";
  return pathname.startsWith("/beach/") ? `/app${pathname.slice(6)}` : null;
}

const TOKEN_REST = /^\/app\/[A-Za-z0-9_-]{16,64}(\/.*)?$/;

/** Teil nach dem Token in einem internen Pfad (`/app/<token>/awards` → `/awards`), sonst "". */
export function riderRestOf(appPath: string): string {
  const rest = TOKEN_REST.exec(appPath)?.[1] ?? "";
  // Nur einfache Pfade weitergeben (keine Steuerzeichen, kein `//`).
  return /^(\/[A-Za-z0-9_.%-]+)*$/.test(rest) ? rest : "";
}

/** Manifest-Daten einer App (allgemein oder persönlich mit `start`). */
export function riderManifest(kind: RiderAppKind, start: string, accountName?: string) {
  const b = APP_BRAND[kind];
  return {
    id: start,
    name: accountName ? `${b.name} · ${accountName}` : b.name,
    short_name: b.name,
    description: b.description,
    start_url: start,
    // Ganze App, nicht nur der eigene Pfad: sonst öffnet iOS den Wechsel zu
    // einer anderen Person der Familie in einem eigenen Browserfenster.
    scope: APP_PREFIX[kind],
    display: "standalone",
    display_override: ["standalone"],
    orientation: "portrait",
    background_color: "#0b1214",
    theme_color: "#0b1214",
    lang: "de",
    icons: [
      { src: `/app-icons/${b.icon}-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/app-icons/${b.icon}-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/app-icons/${b.icon}-maskable-192.png`, sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: `/app-icons/${b.icon}-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
