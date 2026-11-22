import type { Metadata, Viewport } from "next";
import { Barlow_Condensed } from "next/font/google";
import "./rider.css";
import { RiderUpdatePrompt } from "@/components/rider/rider-update-prompt";
import { riderAppKind } from "@/lib/rider-base";
import { APP_BRAND } from "@/lib/rider-app-kind";

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["700", "800"],
  style: ["italic"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

export const viewport: Viewport = { themeColor: "#0b1214" };

/** Eigenes Icon „Ride Pass“ bzw. „Beach Pass“ für Tab, Lesezeichen und Home-Bildschirm (ersetzt das Verwaltungs-Icon). */
export async function generateMetadata(): Promise<Metadata> {
  const brand = APP_BRAND[await riderAppKind()];
  return {
    title: brand.name,
    description: "Abo, Gutscheine und Statistik auf einen Blick.",
    robots: { index: false, follow: false },
    icons: {
      icon: [
        { url: `/app-icons/${brand.icon}-32.png`, sizes: "32x32", type: "image/png" },
        { url: `/app-icons/${brand.icon}-192.png`, sizes: "192x192", type: "image/png" },
        { url: `/app-icons/${brand.icon}.svg`, type: "image/svg+xml" },
      ],
      apple: [{ url: `/app-icons/${brand.icon}-apple-180.png`, sizes: "180x180", type: "image/png" }],
    },
  };
}

/** Rahmen der Kunden-App: eigenes Design (rider.css), unabhängig vom Hell/Dunkel der Verwaltung. */
export default async function RiderRootLayout({ children }: { children: React.ReactNode }) {
  // Beach Pass (/beach): eigene Farben schon auf Anmeldung und Einrichten.
  const beach = (await riderAppKind()) === "beach";
  return (
    <div className={`rd-root ${display.variable}${beach ? " rd-pass-beach" : ""}`}>
      <div className="rd-shell">{children}</div>
      <RiderUpdatePrompt />
    </div>
  );
}
