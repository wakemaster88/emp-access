import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { SectionHeading } from "@/components/ui/section-heading";
import { EmailSettings } from "@/components/settings/email-settings";
import { InfoRequestsCard } from "@/components/settings/info-requests-card";

export const dynamic = "force-dynamic";

export default async function EmailPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const db = tenantClient(session.user.accountId);

  const [emailConfig, subscriptionRefs, serviceRefs] = await Promise.all([
    db.emailConfig.findUnique({
      where: { accountId: session.user.accountId },
    }),
    db.subscription.findMany({
      where: { accountId: session.user.accountId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.service.findMany({
      where: { accountId: session.user.accountId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const emailConfigDto = emailConfig
    ? {
        id: emailConfig.id,
        provider: emailConfig.provider,
        apiKey: emailConfig.apiKey
          ? `${emailConfig.apiKey.slice(0, 6)}${"•".repeat(Math.max(0, emailConfig.apiKey.length - 6))}`
          : null,
        hasApiKey: !!emailConfig.apiKey,
        fromEmail: emailConfig.fromEmail,
        fromName: emailConfig.fromName,
        replyTo: emailConfig.replyTo,
        isActive: emailConfig.isActive,
        brandColor: emailConfig.brandColor,
        logoUrl: emailConfig.logoUrl,
        websiteUrl: emailConfig.websiteUrl,
      }
    : null;

  return (
    <>
      <Header title="E-Mail" accountName={session.user.accountName} />
      <div className="page-content max-w-3xl space-y-4 sm:space-y-5">
        <SectionHeading
          title="E-Mail-Versand & Automationen"
          description="SMTP-Verbindung, regelbasierte Mails und vollständige Versand-Historie."
        />
        <EmailSettings
          initialConfig={emailConfigDto}
          subscriptions={subscriptionRefs}
          services={serviceRefs}
        />
        <InfoRequestsCard services={serviceRefs} />
      </div>
    </>
  );
}
