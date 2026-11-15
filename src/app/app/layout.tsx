import type { Metadata, Viewport } from "next";
import { Barlow_Condensed } from "next/font/google";
import "./rider.css";

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["700", "800"],
  style: ["italic"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

export const viewport: Viewport = { themeColor: "#060d1a" };

export const metadata: Metadata = {
  title: "Deine Saison",
  description: "Abo, Gutscheine und Statistik auf einen Blick.",
  robots: { index: false, follow: false },
  // Eigenes Icon „Ride Pass“ für Tab, Lesezeichen und Home-Bildschirm (ersetzt das Verwaltungs-Icon).
  icons: {
    icon: [
      { url: "/app-icons/ride-pass-32.png", sizes: "32x32", type: "image/png" },
      { url: "/app-icons/ride-pass-192.png", sizes: "192x192", type: "image/png" },
      { url: "/app-icons/ride-pass.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/app-icons/ride-pass-apple-180.png", sizes: "180x180", type: "image/png" }],
  },
};

/** Rahmen der Kunden-App: eigenes Design (rider.css), unabhängig vom Hell/Dunkel der Verwaltung. */
export default function RiderRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`rd-root ${display.variable}`}>
      <div className="rd-shell">{children}</div>
    </div>
  );
}
