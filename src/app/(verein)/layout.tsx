import type { Viewport } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import "../(rider)/rider-base.css";
import "../(rider)/app/rider.css";
import "./verein.css";

/*
 * Eigener Wurzelrahmen des Vereinsportals (/verein/<token>): Look der
 * Kunden-App (rider.css, dunkel, Petrol und Gelb, kursive Versalschrift),
 * ohne das Tailwind-CSS und die Skripte der Verwaltung. Aaron, 22.11.2026:
 * „soll mobil richtig sexy sein“.
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["700", "800"],
  style: ["italic"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  minimumScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#0b1214",
};

export default function VereinRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${inter.variable} ${display.variable}`}>
      <body>
        <div className="rd-root">
          <div className="rd-shell">{children}</div>
        </div>
      </body>
    </html>
  );
}
