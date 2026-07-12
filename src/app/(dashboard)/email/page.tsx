import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
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
      <div className="p-4 sm:p-6 space-y-6 max-w-3xl">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            E-Mail-Versand & Automationen
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            SMTP-Verbindung, regelbasierte Mails und vollständige Versand-Historie.
          </p>
        </div>
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
