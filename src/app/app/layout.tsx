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

export const viewport: Viewport = { themeColor: "#0b1214" };

export const metadata: Metadata = {
  title: "Deine Saison",
  description: "Abo, Gutscheine und Statistik auf einen Blick.",
  robots: { index: false, follow: false },
};

/** Rahmen der Kunden-App: eigenes Design (rider.css), unabhängig vom Hell/Dunkel der Verwaltung. */
export default function RiderRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`rd-root ${display.variable}`}>
      <div className="rd-shell">{children}</div>
    </div>
  );
}
