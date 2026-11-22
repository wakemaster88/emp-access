import { NextResponse } from "next/server";
import { loadRider, riderAppPath } from "@/lib/rider-app";
import { PASS_NAME } from "@/lib/rider-pass";

/** Web-App-Manifest je Fahrer, damit die App mit eigenem Namen auf dem Home-Bildschirm liegt. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await loadRider(token).catch(() => null);
  if (!rider) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const path = riderAppPath(token);
  return NextResponse.json(
    {
      id: path,
      name: `${PASS_NAME[rider.pass]} · ${rider.accountName}`,
      short_name: PASS_NAME[rider.pass],
      description: "Abo, Gutscheine und Statistik",
      start_url: path,
      // Ganz /app, nicht nur der eigene Pfad: sonst öffnet iOS den Wechsel zu
      // einer anderen Person der Familie (/app/<anderer Token>) in einem
      // eigenen Browserfenster statt in der App (Aaron, 21.11.2026).
      scope: "/app",
      display: "standalone",
      display_override: ["standalone"],
      orientation: "portrait",
      background_color: "#0b1214",
      theme_color: "#0b1214",
      lang: "de",
      icons: [
        // Eigenes Icon der Kunden-App („Ride Pass“, CI Tuttenbrocksee), nicht das EMP-Access-Icon der Verwaltung.
        { src: "/app-icons/ride-pass-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/app-icons/ride-pass-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/app-icons/ride-pass-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/app-icons/ride-pass-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "private, max-age=300" } },
  );
}
