import { NextResponse } from "next/server";

/**
 * Allgemeines Manifest der Kunden-App für `/app` (Anmeldung). Vorher galt dort
 * das Verwaltungs-Manifest („EMP Access“, Start auf `/`): Wer die App von der
 * Startseite aus zum Home-Bildschirm hinzufügte, landete in der Verwaltung.
 * Unter `/app/<token>` gilt weiter das persönliche Manifest.
 */
export function GET() {
  return NextResponse.json(
    {
      id: "/app",
      name: "Ride Pass",
      short_name: "Ride Pass",
      description: "Abo, Gutscheine und Statistik",
      start_url: "/app",
      scope: "/app",
      display: "standalone",
      display_override: ["standalone"],
      orientation: "portrait",
      background_color: "#0b1214",
      theme_color: "#0b1214",
      lang: "de",
      icons: [
        { src: "/app-icons/ride-pass-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/app-icons/ride-pass-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/app-icons/ride-pass-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/app-icons/ride-pass-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=3600" } },
  );
}
