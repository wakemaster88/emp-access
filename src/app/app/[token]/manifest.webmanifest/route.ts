import { NextResponse } from "next/server";
import { loadRider, riderAppPath } from "@/lib/rider-app";

/** Web-App-Manifest je Fahrer, damit die App mit eigenem Namen auf dem Home-Bildschirm liegt. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await loadRider(token).catch(() => null);
  if (!rider) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const path = riderAppPath(token);
  return NextResponse.json(
    {
      id: path,
      name: `Ride in · ${rider.accountName}`,
      short_name: "Ride in",
      description: "Abo, Gutscheine und Statistik",
      start_url: path,
      scope: path,
      display: "standalone",
      display_override: ["standalone"],
      orientation: "portrait",
      background_color: "#060d1a",
      theme_color: "#060d1a",
      lang: "de",
      icons: [
        // Eigenes Icon der Kunden-App („Ride in“, CI Tuttenbrocksee), nicht das EMP-Access-Icon der Verwaltung.
        { src: "/app-icons/ride-in-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/app-icons/ride-in-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/app-icons/ride-in-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/app-icons/ride-in-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "private, max-age=300" } },
  );
}
