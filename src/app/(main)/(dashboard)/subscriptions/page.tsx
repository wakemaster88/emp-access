import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { SubscriptionsTable } from "@/components/subscriptions/subscriptions-table";
import { ExpiringAbosCard } from "@/components/subscriptions/expiring-abos-card";
import { SubscriptionStats } from "@/components/subscriptions/subscription-stats";
import { computeSubscriptionStats } from "@/lib/subscription-stats";
import { AbosWithoutEmailCard } from "@/components/subscriptions/abos-without-email-card";
import { loadAbosWithoutEmail } from "@/lib/abos-without-email";
import { RidersOpenCard } from "@/components/subscriptions/riders-open-card";
import { loadRidersOpen } from "@/lib/riders-open";
import { PaymentOpenCard } from "@/components/subscriptions/payment-open-card";
import { loadPaymentOpen } from "@/lib/payment-open";
import { parseDunningConfig } from "@/lib/dunning-state";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { CustomerAccountsCard } from "@/components/subscriptions/customer-accounts-card";
import { loadCustomerAccounts } from "@/lib/customer-accounts";
import { isTenantAdminRole } from "@/lib/api-auth";

interface AnnyExtra {
  services?: string[];
  resources?: string[];
  subscriptions?: string[];
}

interface Props {
  searchParams: Promise<{ ansicht?: string }>;
}

export default async function SubscriptionsPage({ searchParams }: Props) {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  // Kundenkonten gibt es je Mandant; der Super-Admin sieht nur die Abos.
  const { ansicht } = await searchParams;
  const view = !isSuperAdmin && ansicht === "konten" ? "konten" : "abos";
  const views = isSuperAdmin ? null : (
    <SegmentedLinks
      aria-label="Ansicht"
      value={view}
      options={[
        { value: "abos", label: "Abos", href: "/subscriptions" },
        { value: "konten", label: "Kundenkonten", href: "/subscriptions?ansicht=konten" },
      ]}
    />
  );

  if (view === "konten") {
    const accounts = await loadCustomerAccounts(db as unknown as PrismaClient, session.user.accountId!);
    return (
      <>
        <Header title="Abos" accountName={session.user.accountName} />
        <div className="page-content space-y-4 sm:space-y-5">
          {views}
          <CustomerAccountsCard data={accounts} canMerge={isTenantAdminRole(session.user.role)} />
        </div>
      </>
    );
  }

  const [subscriptions, areas, annyConfig, expiringAboTickets, stats, abosWithoutEmail, ridersOpen, paymentOpen] = await Promise.all([
    db.subscription.findMany({
      where: accountFilter,
      include: {
        areas: { select: { id: true, name: true } },
        _count: { select: { tickets: true } },
        tickets: {
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            startDate: true,
            endDate: true,
            status: true,
            ticketTypeName: true,
            rfidCode: true,
            barcode: true,
          },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.accessArea.findMany({
      where: accountFilter,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.apiConfig.findFirst({
      where: { ...accountFilter, provider: "ANNY" },
      select: { extraConfig: true },
    }).catch(() => null),
    db.ticket.findMany({
      where: {
        ...accountFilter,
        subscriptionId: { not: null },
        endDate: { not: null, gt: new Date() },
        status: { in: ["VALID", "REDEEMED", "PAUSED"] },
      },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        endDate: true,
        status: true,
        ticketTypeName: true,
        barcode: true,
        qrCode: true,
        rfidCode: true,
        subscription: { select: { id: true, name: true } },
      },
      orderBy: { endDate: "asc" },
      take: 10,
    }),
    isSuperAdmin
      ? Promise.resolve(null)
      : computeSubscriptionStats(db as unknown as PrismaClient, session.user.accountId!, 365),
    isSuperAdmin
      ? Promise.resolve([])
      : loadAbosWithoutEmail(db as unknown as PrismaClient, session.user.accountId!),
    isSuperAdmin
      ? Promise.resolve([])
      : loadRidersOpen(db as unknown as PrismaClient, session.user.accountId!),
    isSuperAdmin
      ? Promise.resolve([])
      : loadPaymentOpen(db as unknown as PrismaClient, session.user.accountId!),
  ]);

  let annyServices: string[] = [];
  let annyResources: string[] = [];
  let annySubscriptions: string[] = [];
  if (annyConfig?.extraConfig) {
    try {
      const parsed: AnnyExtra = JSON.parse(annyConfig.extraConfig);
      annyServices = (parsed.services || []).sort();
      annyResources = (parsed.resources || []).sort();
      annySubscriptions = (parsed.subscriptions || []).sort();
    } catch { /* ignore */ }
  }

  return (
    <>
      <Header title="Abos" accountName={session.user.accountName} />
      <div className="page-content space-y-4 sm:space-y-5">
        {views}
        {stats && <SubscriptionStats stats={stats} />}
        {/* Vom anny-Abgleich wegen überfälliger Rechnung pausiert (lib/payment-open). */}
        {paymentOpen.length > 0 && (
          <PaymentOpenCard
            rows={paymentOpen}
            dunningEnabled={parseDunningConfig(annyConfig?.extraConfig).enabled}
            readonly={!isTenantAdminRole(session.user.role)}
          />
        )}
        <ExpiringAbosCard tickets={expiringAboTickets} readonly={isSuperAdmin} />
        {/* Jedes Abo hängt an einer E-Mail-Adresse (lib/abo-email); ältere ohne Adresse stehen hier. */}
        {abosWithoutEmail.length > 0 && <AbosWithoutEmailCard rows={abosWithoutEmail} />}
        {/* Abos mit Kundenkonto, aber ohne Person (lib/customer-person): wer fährt? */}
        {ridersOpen.length > 0 && <RidersOpenCard rows={ridersOpen} />}
        {/* Tabelle läuft bis an den Kartenrand, daher unten kein Innenabstand.
            Den Kopf der Karte (Titel, Beschreibung, „Abo anlegen“) rendert SubscriptionsTable. */}
        <Card flush>
          <SubscriptionsTable
            subscriptions={subscriptions}
            areas={areas}
            annyServices={isSuperAdmin ? [] : annyServices}
            annyResources={isSuperAdmin ? [] : annyResources}
            annySubscriptions={isSuperAdmin ? [] : annySubscriptions}
            readonly={isSuperAdmin}
          />
        </Card>
      </div>
    </>
  );
}
