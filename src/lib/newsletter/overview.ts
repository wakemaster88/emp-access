import type { TenantDb } from "@/lib/prisma";
import { berlinDateTime } from "./format";
import { loadGroupRows, type GroupCounts } from "./groups";
import { CAMPAIGN_STATUS_LABEL, type CampaignStatus } from "./rules";
import { campaignStats, recentChange, subscriberTimeline, type CampaignStats, type TimelinePoint } from "./stats";

/** Zahlen für den Reiter „Übersicht“. Nur lesen, über den Mandanten-Client. */

export interface OverviewCampaign {
  id: number;
  subject: string;
  status: CampaignStatus;
  statusLabel: string;
  dateLabel: string | null;
  groupNames: string[];
  stats: CampaignStats;
}

export interface NewsletterOverview {
  change30: { joined: number; left: number };
  timeline: TimelinePoint[];
  groups: GroupCounts[];
  /** Alle Mails aller Aussendungen zusammen. */
  totals: CampaignStats;
  sentCampaigns: number;
  lastSentLabel: string | null;
  drafts: number;
  recent: OverviewCampaign[];
}

export async function loadNewsletterOverview(db: TenantDb, accountId: number, now: Date = new Date()): Promise<NewsletterOverview> {
  const [subscribers, groups, sendGroups, unsubTotal, campaigns, drafts] = await Promise.all([
    db.newsletterSubscriber.findMany({
      where: { accountId },
      select: {
        status: true, source: true, confirmedAt: true, consentAt: true, createdAt: true,
        unsubscribedAt: true, bouncedAt: true, complainedAt: true,
      },
    }),
    loadGroupRows(db, accountId),
    db.newsletterSend.groupBy({ by: ["campaignId", "status"], where: { accountId }, _count: { _all: true } }),
    db.newsletterSend.groupBy({ by: ["campaignId"], where: { accountId, unsubscribedAt: { not: null } }, _count: { _all: true } }),
    db.newsletterCampaign.findMany({
      where: { accountId, status: { not: "DRAFT" } },
      orderBy: [{ queuedAt: "desc" }, { id: "desc" }],
      select: { id: true, subject: true, status: true, queuedAt: true, finishedAt: true, groupIds: true },
    }),
    db.newsletterCampaign.count({ where: { accountId, status: "DRAFT" } }),
  ]);

  const statsFor = (campaignId: number | null) =>
    campaignStats(
      sendGroups.filter((g) => campaignId === null || g.campaignId === campaignId).map((g) => ({ status: g.status, count: g._count._all })),
      unsubTotal.filter((g) => campaignId === null || g.campaignId === campaignId).reduce((sum, g) => sum + g._count._all, 0),
    );
  const sent = campaigns.filter((c) => c.status === "SENT");
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  return {
    change30: recentChange(subscribers, 30, now),
    timeline: subscriberTimeline(subscribers, 26, now),
    groups,
    totals: statsFor(null),
    sentCampaigns: sent.length,
    lastSentLabel: berlinDateTime(sent.map((c) => c.finishedAt ?? c.queuedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0]),
    drafts,
    recent: campaigns.slice(0, 8).map((c) => {
      const status = c.status as CampaignStatus;
      return {
        id: c.id,
        subject: c.subject,
        status,
        statusLabel: CAMPAIGN_STATUS_LABEL[status] ?? c.status,
        dateLabel: berlinDateTime(status === "SENT" ? (c.finishedAt ?? c.queuedAt) : c.queuedAt),
        groupNames: (c.groupIds ?? []).map((id) => groupName.get(id) ?? "gelöschte Gruppe"),
        stats: statsFor(c.id),
      };
    }),
  };
}
