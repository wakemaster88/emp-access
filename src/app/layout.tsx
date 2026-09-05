import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SwRegister } from "@/components/layout/sw-register";
import { appleStartupImages } from "@/lib/pwa-splash";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  minimumScale: 1,
  viewportFit: "cover",
  // Android/Chrome: Tastatur verkleinert den Viewport statt ihn zu ueberdecken.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export const metadata: Metadata = {
  title: "EMP Access - Zugangskontrolle",
  description: "Modernes Zugangskontrollsystem für Drehkreuze, Türen und Smart Relays",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "EMP Access",
    // Ohne passendes Startbild zeigt iOS beim Start einer Home-Bildschirm-App
    // nur Weiss. Die PNGs erzeugt `npx tsx scripts/gen-pwa-assets.ts`.
    startupImage: appleStartupImages(),
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  icons: {
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning className="touch-manipulation">
      <body className={`${inter.className} antialiased min-h-[100dvh] safe-area-padding`}>
        <ThemeProvider>
          <TooltipProvider delayDuration={0}>
            {children}
          </TooltipProvider>
        </ThemeProvider>
        <SwRegister />
      </body>
    </html>
  );
}
