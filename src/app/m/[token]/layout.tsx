import type { Metadata } from "next";
import { loadEmployeeByMobileTokenCached as loadEmployeeByMobileToken } from "@/lib/employee-access";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { appleStartupImages } from "@/lib/pwa-splash";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}

/**
 * Erzeugt fuer jeden Mitarbeiter ein eigenes Manifest unter
 * `/m/<token>/manifest.webmanifest`, sodass beim Hinzufuegen zum Home-
 * Bildschirm Name und Icon stimmen.
 */
export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { token } = await params;
  const profile = await loadEmployeeByMobileToken(token).catch(() => null);
  const displayName = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.name
    : "Zugang";
  const accountSuffix = profile ? ` · ${profile.accountName}` : "";

  return {
    title: `${displayName} – Zugang`,
    description: `Mobile Zugangskontrolle${accountSuffix}`,
    manifest: `/m/${token}/manifest.webmanifest`,
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: displayName,
      startupImage: appleStartupImages(),
    },
    robots: { index: false, follow: false },
  };
}

export default async function MobileLayout({ children, params }: LayoutProps) {
  const { token } = await params;
  const profile = await loadEmployeeByMobileToken(token).catch(() => null);
  const appName = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.name
    : "Zugang";

  // Der Body traegt die Safe-Area als Padding; hier wird es oben aufgehoben,
  // damit der Farbverlauf des Kopfes bis unter die Statusleiste reicht (der
  // Kopf selbst pad­det um die Inset-Hoehe).
  return (
    <div className="min-h-[100dvh] mt-[calc(env(safe-area-inset-top)*-1)] bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {children}
      <InstallPrompt variant="banner" appName={appName} />
    </div>
  );
}
