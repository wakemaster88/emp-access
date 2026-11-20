import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPortalPartner } from "@/lib/venue-events";
import { PartnerPortalClient } from "@/components/partner-portal/partner-portal-client";

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const partner = await loadPortalPartner(token).catch(() => null);
  return {
    title: partner ? `${partner.name} – Veranstaltungen` : "Partnerzugang",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/** Partnerzugang: der Partner verwaltet über diesen geheimen Link seine Veranstaltungen. */
export default async function PartnerPortalPage({ params }: PageProps) {
  const { token } = await params;
  const partner = await loadPortalPartner(token);
  if (!partner) notFound();
  return (
    <div className="page-ambient min-h-[100dvh]">
      <PartnerPortalClient token={token} partnerName={partner.name} accountName={partner.account.name} />
    </div>
  );
}
