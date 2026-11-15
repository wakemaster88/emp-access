import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadRiderCached, riderAppPath } from "@/lib/rider-app";
import { appleStartupImages } from "@/lib/pwa-splash";
import { RiderNav } from "@/components/rider/rider-nav";

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
      title: "Deine Saison",
      startupImage: appleStartupImages(),
    },
    robots: { index: false, follow: false },
  };
}

export default async function RiderLayout({ children, params }: LayoutProps) {
  const { token } = await params;
  const rider = await loadRiderCached(token);
  if (!rider) notFound();
  return (
    <>
      <main className="rd-main">{children}</main>
      <RiderNav base={riderAppPath(token)} />
    </>
  );
}
