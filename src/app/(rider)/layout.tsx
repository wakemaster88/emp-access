import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./rider-base.css";
import { SwRegister } from "@/components/layout/sw-register";

/*
 * Eigener Wurzelrahmen der Kunden-App. Sie nutzt nur ihre `rd-`-Klassen
 * (app/rider.css) und keine ui-Bausteine der Verwaltung. Ohne diesen Rahmen
 * lud jede Kunden-Seite das ganze Tailwind-CSS der Verwaltung (≈ 37 KB,
 * blockiert die Anzeige), Theme- und Tooltip-Skripte und das falsche
 * Manifest (Lighthouse 21.11.2026: mobil 86 Punkte, LCP 3,7 s).
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// Monospace nur für Codes (Kasse, Gutschein): nicht vorab laden.
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap", preload: false });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  minimumScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#0b1214",
};

export const metadata: Metadata = {
  title: "Deine Saison",
  description: "Abo, Gutscheine und Statistik auf einen Blick.",
  // Allgemeines Ride-Pass-Manifest; unter /app/<token> gilt das persönliche.
  manifest: "/app/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Ride Pass" },
  formatDetection: { telephone: false, email: false, address: false },
};

export default function RiderRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${inter.variable} ${mono.variable}`}>
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
