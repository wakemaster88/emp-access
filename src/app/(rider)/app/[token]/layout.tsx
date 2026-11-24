import type { Metadata } from "next";
import { loadRiderAccountName } from "@/lib/rider-app";
import { riderAppKind, riderHome } from "@/lib/rider-base";
import { APP_BRAND } from "@/lib/rider-app-kind";
import { appleStartupImages } from "@/lib/pwa-splash";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { token } = await params;
  // Nur der Kontoname für den Titel; das ganze Profil lädt erst die geschützte Seite.
  const name = (await loadRiderAccountName(token).catch(() => null)) ?? "Deine Saison";
  const brand = APP_BRAND[await riderAppKind()];
  return {
    title: `${brand.name} · ${name}`,
    icons: {
      icon: [
        { url: `/app-icons/${brand.icon}-32.png`, sizes: "32x32", type: "image/png" },
        { url: `/app-icons/${brand.icon}-192.png`, sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: `/app-icons/${brand.icon}-apple-180.png`, sizes: "180x180", type: "image/png" }],
    },
    manifest: `${await riderHome(token)}/manifest.webmanifest`,
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: brand.name,
      startupImage: appleStartupImages(),
    },
    robots: { index: false, follow: false },
  };
}

/** Rahmen je Fahrer: nur Metadaten. Die Navigation hängt am geschützten Teil `(app)`. */
export default function RiderLayout({ children }: LayoutProps) {
  return children;
}
