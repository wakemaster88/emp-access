import type { Metadata } from "next";
import { loadEmployeeByMobileToken } from "@/lib/employee-access";

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
    },
    robots: { index: false, follow: false },
  };
}

export default function MobileLayout({ children }: LayoutProps) {
  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {children}
    </div>
  );
}
