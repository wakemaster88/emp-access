import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, MailCheck, MailX, Send, UserMinus, Users } from "lucide-react";
import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { isTenantAdminRole } from "@/lib/api-auth";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatCard } from "@/components/ui/stat-card";
import { AutoRefresh } from "@/components/rider/auto-refresh";
import { renderNewsletterHtml } from "@/lib/newsletter/blocks";
import { campaignBlocks, loadSendContext } from "@/lib/newsletter/service";
import { loadGroupRows, recipientsWhere } from "@/lib/newsletter/groups";
import { campaignStats, percent } from "@/lib/newsletter/stats";
import { berlinDateTime } from "@/lib/newsletter/format";
import { CAMPAIGN_STATUS_LABEL, reasonLine, type CampaignStatus } from "@/lib/newsletter/rules";
import { CampaignEditor, CopyCampaignButton, PreviewCard } from "@/components/newsletter/campaign-editor";
import { CampaignActions } from "@/components/newsletter/campaign-actions";
import { ReadinessNotice } from "@/components/newsletter/readiness-notice";
import { campaignBadge } from "@/components/newsletter/campaign-ui";

export const dynamic = "force-dynamic";

export default async function NewsletterCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  const accountId = session.user.accountId;
  if (!accountId || !isTenantAdminRole(session.user.role)) redirect("/");

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const db = tenantClient(accountId);
  const campaign = await db.newsletterCampaign.findFirst({ where: { id, accountId } });
  if (!campaign) notFound();

  const [ctx, groupRows] = await Promise.all([loadSendContext(accountId), loadGroupRows(db, accountId)]);
  const groupIds = campaign.groupIds ?? [];
  const groupNames = groupIds.map((g) => groupRows.find((x) => x.id === g)?.name ?? "gelöschte Gruppe");
  const status = campaign.status as CampaignStatus;
  const blocks = campaignBlocks(campaign.blocks);
  const reason = reasonLine(ctx.accountName);
  const editorCampaign = { id: campaign.id, subject: campaign.subject, preheader: campaign.preheader ?? "", blocks, groupIds };

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 max-sm:h-11">
      <Link href="/newsletter?tab=aussendungen">
        <ArrowLeft className="h-4 w-4" />
        Aussendungen
      </Link>
    </Button>
  );

  if (status === "DRAFT") {
    const blockingForTest = ctx.gaps.filter((g) => !g.startsWith("Versand ist ausgeschaltet"));
    const knownIds = groupIds.filter((g) => groupRows.some((x) => x.id === g));
    const recipientCount = await db.newsletterSubscriber.count({ where: recipientsWhere(accountId, knownIds) });
    return (
      <>
        <Header title="Newsletter" accountName={session.user.accountName} />
        <div className="page-content space-y-4 sm:space-y-5">
          {back}
          <ReadinessNotice gaps={ctx.gaps} onSettings={false} />
          <CampaignEditor
            campaign={editorCampaign}
            brand={ctx.brand}
            reason={reason}
            groups={groupRows.map((g) => ({ id: g.id, name: g.name, active: g.active }))}
            recipientCount={recipientCount}
            canSend={ctx.gaps.length === 0}
            canTest={blockingForTest.length === 0}
            testTo={session.user.email ?? ""}
          />
        </div>
      </>
    );
  }

  const [groups, unsubscribed] = await Promise.all([
    db.newsletterSend.groupBy({ by: ["status"], where: { accountId, campaignId: id }, _count: { _all: true } }),
    db.newsletterSend.count({ where: { accountId, campaignId: id, unsubscribedAt: { not: null } } }),
  ]);
  const stats = campaignStats(groups.map((g) => ({ status: g.status, count: g._count._all })), unsubscribed);
  const running = status === "QUEUED" || status === "SENDING";
  const html = renderNewsletterHtml(blocks, { brand: ctx.brand, preheader: campaign.preheader, unsubscribeUrl: "#", reason });
  const when =
    status === "SENT"
      ? `Versendet ${berlinDateTime(campaign.finishedAt)}`
      : status === "CANCELLED"
        ? `Angehalten ${berlinDateTime(campaign.finishedAt)}`
        : `Gestartet ${berlinDateTime(campaign.queuedAt)}`;

  return (
    <>
      <Header title="Newsletter" accountName={session.user.accountName} />
      {running && <AutoRefresh seconds={10} />}
      <div className="page-content space-y-4 sm:space-y-5">
        {back}
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 break-words">{campaign.subject}</span>
              <Badge variant={campaignBadge(status)} className="font-normal">
                {CAMPAIGN_STATUS_LABEL[status] ?? status}
                {status === "SENDING" ? ` · ${stats.progress} %` : ""}
              </Badge>
            </CardTitle>
            <CardDescription>
              {when}
              {` · an ${groupNames.length ? groupNames.join(", ") : "alle angemeldeten"}`}
              {campaign.createdBy ? ` · angelegt von ${campaign.createdBy}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {running && campaign.lastError && (
              <Notice tone="danger" title="Versand stockt">
                {campaign.lastError}
                <span className="mt-1 block">emp-access versucht es alle 10 Minuten erneut.</span>
              </Notice>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard variant="tile" size="sm" label="Empfänger" value={stats.total} icon={Users} tone="primary" />
              <StatCard
                variant="tile"
                size="sm"
                label="Verschickt"
                value={stats.sent}
                icon={Send}
                tone="info"
                progress={stats.progress / 100}
                hint={stats.waiting ? `${stats.waiting} warten` : undefined}
              />
              <StatCard variant="tile" size="sm" label="Zugestellt" value={stats.delivered} icon={MailCheck} tone="success" hint={percent(stats.delivered, stats.sent)} />
              <StatCard
                variant="tile"
                size="sm"
                label="Unzustellbar"
                value={stats.bounced + stats.failed}
                icon={MailX}
                tone={stats.bounced + stats.failed ? "danger" : "neutral"}
                hint={stats.complained ? `${stats.complained} als Spam gemeldet` : percent(stats.bounced + stats.failed, stats.sent + stats.failed)}
              />
              <StatCard variant="tile" size="sm" label="Abgemeldet" value={stats.unsubscribed} icon={UserMinus} tone="neutral" hint={percent(stats.unsubscribed, stats.sent)} />
            </div>
            {stats.skipped > 0 && (
              <p className="text-xs text-muted-foreground">
                {stats.skipped} nicht verschickt, weil angehalten oder vorher abgemeldet.
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <CampaignActions id={campaign.id} canCancel={running} canDelete={status === "CANCELLED"} />
              <CopyCampaignButton campaign={editorCampaign} />
            </div>
          </CardContent>
        </Card>
        <PreviewCard html={html} subject={campaign.subject} preheader={campaign.preheader ?? ""} />
      </div>
    </>
  );
}
