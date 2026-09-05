import type { Metadata, Viewport } from "next";
import { appleStartupImages } from "@/lib/pwa-splash";

/**
 * PWA-Bausteine fuer die oeffentlichen Token-Seiten: Kiosk, Scan-Monitor,
 * Auslastungs-Monitor und Scanner bekommen jeweils ein eigenes Manifest,
 * damit ein iPad sie als eigenstaendige Vollbild-App auf den Home-Bildschirm
 * legen kann – mit dem Namen des Monitors statt "EMP Access".
 */
export const PUBLIC_APP_KINDS = ["checkin", "monitor", "resource-monitor", "scanner"] as const;
export type PublicAppKind = (typeof PUBLIC_APP_KINDS)[number];

export const PUBLIC_APP_MONITOR_TYPE: Record<PublicAppKind, string> = {
  checkin: "CHECKIN",
  monitor: "MONITOR",
  "resource-monitor": "RESOURCE_MONITOR",
  scanner: "SCANNER",
};

const KIND_LABEL: Record<PublicAppKind, string> = {
  checkin: "Check-in",
  monitor: "Scan-Monitor",
  "resource-monitor": "Auslastung",
  scanner: "Scanner",
};

const DARK_BG = "#020617";

export function publicAppPath(kind: PublicAppKind, token: string): string {
  return `/${kind}/${encodeURIComponent(token)}`;
}

export function publicAppManifestUrl(kind: PublicAppKind, token: string): string {
  return `/api/pwa-manifest/${kind}/${encodeURIComponent(token)}`;
}

/** Inhalt des Web-App-Manifests fuer eine Token-Seite. */
export function publicAppManifest(kind: PublicAppKind, token: string, name: string) {
  const path = publicAppPath(kind, token);
  const isKiosk = kind === "checkin" || kind === "monitor" || kind === "resource-monitor";
  return {
    id: path,
    name: `${name} · ${KIND_LABEL[kind]}`,
    short_name: name.slice(0, 12),
    description: `EMP Access ${KIND_LABEL[kind]}: ${name}`,
    start_url: path,
    scope: path,
    // Kiosk und Monitore ohne jede Browserleiste; der Scanner behaelt die
    // Statusleiste, weil er in der Hand benutzt wird.
    display: isKiosk ? "fullscreen" : "standalone",
    display_override: isKiosk ? ["fullscreen", "standalone"] : ["standalone"],
    orientation: "any",
    background_color: DARK_BG,
    theme_color: DARK_BG,
    lang: "de",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/** Metadata fuer das Layout einer Token-Seite (Manifest, iOS-App-Tags, kein Index). */
export function publicAppMetadata(kind: PublicAppKind, token: string, name: string): Metadata {
  return {
    title: `${name} – ${KIND_LABEL[kind]}`,
    manifest: publicAppManifestUrl(kind, token),
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: name,
      startupImage: appleStartupImages(),
    },
    robots: { index: false, follow: false },
  };
}

/** Dunkle Statusleiste fuer die dunklen Token-Seiten. */
export const darkViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  minimumScale: 1,
  viewportFit: "cover",
  themeColor: DARK_BG,
};
