import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPortalVerein } from "@/lib/verein-portal";
import { VereinPortalClient } from "@/components/verein-portal/verein-portal-client";

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const verein = await loadPortalVerein(token).catch(() => null);
  return {
    title: verein ? `${verein.name} · Buchen` : "Vereinsportal",
    robots: { index: false, follow: false },
    formatDetection: { telephone: false, email: false, address: false },
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: verein?.name ?? "Vereinsportal" },
  };
}

/** Vereinsportal: der Verein bucht über diesen geheimen Link selbst Slots. */
export default async function VereinPortalPage({ params }: PageProps) {
  const { token } = await params;
  const verein = await loadPortalVerein(token);
  if (!verein) notFound();
  return <VereinPortalClient token={token} vereinName={verein.name} accountName={verein.account.name} />;
}
