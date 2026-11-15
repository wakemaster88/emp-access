import type { Metadata } from "next";
import { loadRiderCached, riderAppPath } from "@/lib/rider-app";
import { appleStartupImages } from "@/lib/pwa-splash";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { token } = await params;
  const rider = await loadRiderCached(token).catch(() => null);
  const name = rider?.accountName ?? "Deine Saison";
  return {
    title: `Deine Saison · ${name}`,
    manifest: `${riderAppPath(token)}/manifest.webmanifest`,
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "Ride Pass",
      startupImage: appleStartupImages(),
    },
    robots: { index: false, follow: false },
  };
}

/** Rahmen je Fahrer: nur Metadaten. Die Navigation hängt am geschützten Teil `(app)`. */
export default function RiderLayout({ children }: LayoutProps) {
  return children;
}
