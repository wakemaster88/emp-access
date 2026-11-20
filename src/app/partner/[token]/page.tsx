import type { Metadata } from "next";
import { notFound } from "next/navigation";
<<<<<<< HEAD
import { prisma } from "@/lib/prisma";
import { loadPortalPartner, loadVenues } from "@/lib/venue-events";
import { PartnerPortalClient } from "@/components/partner-portal/partner-portal-client";
import "../partner.css";
=======
import { loadPortalPartner } from "@/lib/venue-events";
import { PartnerPortalClient } from "@/components/partner-portal/partner-portal-client";
>>>>>>> origin/claude/project-thread-iy5t9v

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
<<<<<<< HEAD
  const [mail, venues] = await Promise.all([
    prisma.emailConfig.findUnique({ where: { accountId: partner.accountId }, select: { logoUrl: true } }),
    loadVenues(partner.accountId, partner.areaIds),
  ]);
  return (
    <div className="pp-root page-ambient flex min-h-[100dvh] flex-col">
      <PartnerPortalClient
        token={token}
        partnerName={partner.name}
        accountName={partner.account.name}
        partnerLogoUrl={partner.logoUrl}
        accountLogoUrl={mail?.logoUrl ?? null}
        venueNames={venues.map((v) => v.name)}
      />
=======
  return (
    <div className="page-ambient min-h-[100dvh]">
      <PartnerPortalClient token={token} partnerName={partner.name} accountName={partner.account.name} />
>>>>>>> origin/claude/project-thread-iy5t9v
    </div>
  );
}
