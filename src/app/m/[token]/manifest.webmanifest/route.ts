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
      name: `${displayName} · ${account}`,
      short_name: shortName,
      description: `Mobile Zugangskontrolle fuer ${displayName}`,
      start_url: `/m/${token}`,
      scope: `/m/${token}`,
      display: "standalone",
      orientation: "portrait",
      background_color: "#0f172a",
      theme_color: "#4f46e5",
      lang: "de",
      icons: [
        {
          src: "/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any maskable",
        },
        {
          src: "/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable",
        },
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
