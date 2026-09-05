import { NextResponse } from "next/server";
import { loadEmployeeByMobileToken } from "@/lib/employee-access";

/**
 * Dynamisches PWA-Manifest pro Mitarbeiter. Wenn der Mitarbeiter den Link
 * zum Home-Bildschirm hinzufuegt, bekommt der Shortcut seinen Namen + den
 * Account-Namen als Untertitel.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const profile = await loadEmployeeByMobileToken(token).catch(() => null);

  const displayName = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.name
    : "Zugang";
  const shortName = (profile?.firstName || profile?.name || "Zugang").slice(0, 12);
  const account = profile?.accountName ?? "EMP Access";

  return NextResponse.json(
    {
      id: `/m/${token}`,
      name: `${displayName} · ${account}`,
      short_name: shortName,
      description: `Mobile Zugangskontrolle fuer ${displayName}`,
      start_url: `/m/${token}`,
      scope: `/m/${token}`,
      display: "standalone",
      display_override: ["standalone"],
      orientation: "portrait",
      background_color: "#0f172a",
      theme_color: "#4f46e5",
      lang: "de",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    {
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "private, max-age=300",
      },
    },
  );
}
