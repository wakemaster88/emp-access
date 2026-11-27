import { redirect } from "next/navigation";
import { LayoutDashboard, MailCheck, MailX, Send, Settings, UserCheck, UserMinus, Users, UserX } from "lucide-react";
import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { isTenantAdminRole } from "@/lib/api-auth";
import { appOrigin } from "@/lib/rider-invite";
import { Header } from "@/components/layout/header";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { StatCard } from "@/components/ui/stat-card";
import { loadSendContext } from "@/lib/newsletter/service";
import { loadSesStatus } from "@/lib/newsletter/ses-status";
import { campaignStats } from "@/lib/newsletter/stats";
import { berlinDateTime } from "@/lib/newsletter/format";
import {
  CAMPAIGN_STATUS_LABEL, SUBSCRIBER_STATUSES, SUBSCRIBER_STATUS_LABEL, defaultConsentText,
  type CampaignStatus, type SubscriberStatus,
} from "@/lib/newsletter/rules";
import { ReadinessNotice } from "@/components/newsletter/readiness-notice";
import { CampaignsCard, type CampaignRow } from "@/components/newsletter/campaigns-card";
import { SubscribersCard, type SubscriberRow } from "@/components/newsletter/subscribers-card";
import { GroupsCard } from "@/components/newsletter/groups-card";
import { loadGroupRows } from "@/lib/newsletter/groups";
import { NewsletterSettingsCard } from "@/components/newsletter/settings-card";
import { SesStatusCard } from "@/components/newsletter/ses-status-card";
import { OverviewSection } from "@/components/newsletter/overview-section";
import { loadNewsletterOverview } from "@/lib/newsletter/overview";

export const dynamic = "force-dynamic";

type Tab = "uebersicht" | "aussendungen" | "abonnenten" | "einstellungen";
const TABS: Tab[] = ["uebersicht", "aussendungen", "abonnenten", "einstellungen"];
const LIST_LIMIT = 200;

export default async function NewsletterPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string; q?: string; gruppe?: string }>;
}) {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  const accountId = session.user.accountId;
  if (!accountId || !isTenantAdminRole(session.user.role)) redirect("/");

  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "uebersicht";
  const db = tenantClient(accountId);
  const [ctx, statusGroups] = await Promise.all([
    loadSendContext(accountId),
    db.newsletterSubscriber.groupBy({ by: ["status"], where: { accountId }, _count: { _all: true } }),
  ]);
  const countOf = (s: SubscriberStatus) => statusGroups.find((g) => g.status === s)?._count._all ?? 0;
  const activeCount = countOf("ACTIVE");
  const totalSubscribers = statusGroups.reduce((sum, g) => sum + g._count._all, 0);

  const tabs = (
    <SegmentedLinks
      aria-label="Newsletter"
      className="max-sm:[&_svg]:hidden"
      value={tab}
      options={[
        { value: "uebersicht", label: "Übersicht", icon: LayoutDashboard, href: "/newsletter" },
        { value: "aussendungen", label: "Aussendungen", icon: Send, href: "/newsletter?tab=aussendungen" },
        { value: "abonnenten", label: "Abonnenten", icon: Users, href: "/newsletter?tab=abonnenten", count: activeCount },
        { value: "einstellungen", label: "Einstellungen", icon: Settings, href: "/newsletter?tab=einstellungen" },
      ]}
    />
  );

  let content: React.ReactNode = null;

  if (tab === "uebersicht") {
    content = (
      <OverviewSection
        overview={await loadNewsletterOverview(db, accountId)}
        activeCount={activeCount}
        pendingCount={countOf("PENDING")}
        unsubscribedCount={countOf("UNSUBSCRIBED")}
        problemCount={countOf("BOUNCED") + countOf("COMPLAINED")}
      />
    );
  } else if (tab === "aussendungen") {
    const campaigns = await db.newsletterCampaign.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, subject: true, status: true, createdAt: true, queuedAt: true, finishedAt: true, lastError: true },
    });
    const ids = campaigns.map((c) => c.id);
    const [sendGroups, unsubGroups] = ids.length
      ? await Promise.all([
          db.newsletterSend.groupBy({ by: ["campaignId", "status"], where: { accountId, campaignId: { in: ids } }, _count: { _all: true } }),
          db.newsletterSend.groupBy({
            by: ["campaignId"],
            where: { accountId, campaignId: { in: ids }, unsubscribedAt: { not: null } },
            _count: { _all: true },
          }),
        ])
      : [[], []];
    const rows: CampaignRow[] = campaigns.map((c) => {
      const stats = campaignStats(
        sendGroups.filter((g) => g.campaignId === c.id).map((g) => ({ status: g.status, count: g._count._all })),
        unsubGroups.find((g) => g.campaignId === c.id)?._count._all ?? 0,
      );
      const status = c.status as CampaignStatus;
      return {
        id: c.id,
        subject: c.subject,
        status,
        statusLabel: CAMPAIGN_STATUS_LABEL[status] ?? c.status,
        dateLabel:
          status === "DRAFT"
            ? `angelegt ${berlinDateTime(c.createdAt)}`
            : status === "SENT"
              ? `versendet ${berlinDateTime(c.finishedAt ?? c.queuedAt)}`
              : `gestartet ${berlinDateTime(c.queuedAt ?? c.createdAt)}`,
        recipients: stats.total,
        delivered: stats.delivered,
        sent: stats.sent,
        progress: stats.progress,
        hasError: !!c.lastError && (status === "QUEUED" || status === "SENDING"),
      };
    });
    content = <CampaignsCard campaigns={rows} activeCount={activeCount} websiteUrl={ctx.brand.websiteUrl ?? null} />;
  } else if (tab === "abonnenten") {
    const status = SUBSCRIBER_STATUSES.includes(sp.status as SubscriberStatus) ? (sp.status as SubscriberStatus) : null;
    const q = (sp.q ?? "").trim().slice(0, 100);
    const groups = await loadGroupRows(db, accountId);
    const groupParam = Number(sp.gruppe);
    const groupId = groups.some((g) => g.id === groupParam) ? groupParam : null;
    const where = {
      accountId,
      ...(groupId && { groups: { some: { groupId, accountId } } }),
      ...(status === "BOUNCED"
        ? { status: { in: ["BOUNCED", "COMPLAINED"] } }
        : status
          ? { status }
          : {}),
      ...(q && {
        OR: [
          { email: { contains: q.toLowerCase() } },
          { name: { contains: q, mode: "insensitive" as const } },
        ],
      }),
    };
    const [subscribers, matching] = await Promise.all([
      db.newsletterSubscriber.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: LIST_LIMIT,
        include: { groups: { select: { groupId: true } } },
      }),
      db.newsletterSubscriber.count({ where }),
    ]);
    const rows: SubscriberRow[] = subscribers.map((s) => ({
      id: s.id,
      email: s.email,
      name: s.name,
      status: s.status as SubscriberStatus,
      statusLabel: SUBSCRIBER_STATUS_LABEL[s.status as SubscriberStatus] ?? s.status,
      source: s.source,
      createdLabel: berlinDateTime(s.createdAt)!,
      consentText: s.consentText,
      consentLabel: berlinDateTime(s.consentAt),
      consentIp: s.consentIp,
      confirmedLabel: berlinDateTime(s.confirmedAt),
      confirmIp: s.confirmIp,
      confirmMailLabel: berlinDateTime(s.confirmMailSentAt),
      unsubscribedLabel: berlinDateTime(s.unsubscribedAt),
      unsubscribeReason: s.unsubscribeReason,
      bouncedLabel: berlinDateTime(s.bouncedAt ?? s.complainedAt),
      lastSentLabel: berlinDateTime(s.lastSentAt),
      groupIds: s.groups.map((g) => g.groupId),
    }));
    const filterHref = (s: string | null) =>
      `/newsletter?tab=abonnenten${s ? `&status=${s}` : ""}${groupId ? `&gruppe=${groupId}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
    const problemCount = countOf("BOUNCED") + countOf("COMPLAINED");
    content = (
      <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <StatCard
            label="Angemeldet"
            value={activeCount}
            icon={UserCheck}
            tone="success"
            href={filterHref(status === "ACTIVE" ? null : "ACTIVE")}
            active={status === "ACTIVE"}
            size="sm"
          />
          <StatCard
            label="Bestätigung offen"
            value={countOf("PENDING")}
            icon={MailCheck}
            tone="warning"
            href={filterHref(status === "PENDING" ? null : "PENDING")}
            active={status === "PENDING"}
            size="sm"
          />
          <StatCard
            label="Abgemeldet"
            value={countOf("UNSUBSCRIBED")}
            icon={UserMinus}
            tone="neutral"
            href={filterHref(status === "UNSUBSCRIBED" ? null : "UNSUBSCRIBED")}
            active={status === "UNSUBSCRIBED"}
            size="sm"
          />
          <StatCard
            label="Unzustellbar, Spam"
            value={problemCount}
            icon={problemCount ? MailX : UserX}
            tone="danger"
            href={filterHref(status === "BOUNCED" ? null : "BOUNCED")}
            active={status === "BOUNCED"}
            size="sm"
          />
        </div>
        <GroupsCard
          groups={groups}
          selectedId={groupId}
          annyAutoSubscribe={ctx.config.annyAutoSubscribe}
          annySyncedLabel={berlinDateTime(ctx.config.annySyncedAt)}
        />
        <SubscribersCard
          subscribers={rows}
          matching={matching}
          total={totalSubscribers}
          limit={LIST_LIMIT}
          query={q}
          status={status}
          groupId={groupId}
          groups={groups}
          canSend={ctx.gaps.length === 0}
        />
      </>
    );
  } else {
    const sesStatus = await loadSesStatus(ctx.config.fromEmail);
    content = (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start sm:gap-5">
        <NewsletterSettingsCard
          config={{
            enabled: ctx.config.enabled,
            fromEmail: ctx.config.fromEmail ?? "",
            fromName: ctx.config.fromName ?? "",
            replyTo: ctx.config.replyTo ?? "",
            configurationSet: ctx.config.configurationSet ?? "",
            snsTopicArn: ctx.config.snsTopicArn ?? "",
            linkBaseUrl: ctx.config.linkBaseUrl ?? "",
            consentText: ctx.config.consentText ?? "",
          }}
          defaultFromName={ctx.accountName}
          defaultConsent={defaultConsentText(ctx.accountName)}
          linkBase={ctx.base}
          hasCredentials={!!ctx.env}
        />
        <SesStatusCard status={sesStatus} snsEndpoint={`${appOrigin() ?? "https://www.emp-access.de"}/api/newsletter/ses-events`} />
      </div>
    );
  }

  return (
    <>
      <Header title="Newsletter" accountName={session.user.accountName} />
      <div className="page-content space-y-4 sm:space-y-5">
        {tabs}
        <ReadinessNotice gaps={ctx.gaps} onSettings={tab === "einstellungen"} />
        {content}
      </div>
    </>
  );
}


