/**
 * Daten für Newsletter › Social Media: Übersicht (Kampagnen, nächste
 * Beiträge) und eine Kampagne mit Beiträgen und Aussendungen.
 */
import type { TenantDb } from "@/lib/prisma";
import { berlinYmd } from "@/lib/berlin-day";
import { campaignStats } from "@/lib/newsletter/stats";
import type { CampaignStatus } from "@/lib/newsletter/rules";
import {
  campaignPhase, dateOnly, isOverdue, periodLabel,
  type CampaignPhase, type PostStatus, type SocialChannel, type SocialFormat,
} from "./rules";

const DAY_MS = 24 * 60 * 60 * 1000;
/** So weit nach vorn zeigt die Übersicht die nächsten Beiträge. */
export const UPCOMING_DAYS = 14;

export interface SocialCampaignRow {
  id: number;
  name: string;
  slug: string;
  phase: CampaignPhase;
  period: string | null;
  posts: number;
  published: number;
  overdue: number;
  newsletters: number;
  /** Nächster geplanter, nicht veröffentlichter Beitrag. */
  nextPostAt: string | null;
}

export interface SocialPostRow {
  id: number;
  campaignId: number;
  campaignName: string;
  channel: SocialChannel;
  format: SocialFormat;
  status: PostStatus;
  text: string;
  media: string[];
  link: string | null;
  /** ISO-Zeitpunkt. */
  plannedAt: string | null;
  publishedAt: string | null;
  postUrl: string | null;
  reach: number | null;
  interactions: number | null;
  clicks: number | null;
  statsAt: string | null;
  notes: string | null;
  overdue: boolean;
}

export interface SocialOverview {
  campaigns: SocialCampaignRow[];
  upcoming: SocialPostRow[];
  running: number;
  plannedSoon: number;
  overdue: number;
  published30: number;
  reach30: number;
}

type PostRecord = {
  id: number;
  campaignId: number;
  channel: string;
  format: string;
  status: string;
  text: string;
  media: string[];
  link: string | null;
  plannedAt: Date | null;
  publishedAt: Date | null;
  postUrl: string | null;
  reach: number | null;
  interactions: number | null;
  clicks: number | null;
  statsAt: Date | null;
  notes: string | null;
};

export function toPostRow(p: PostRecord, campaignName: string, now: Date = new Date()): SocialPostRow {
  return {
    id: p.id,
    campaignId: p.campaignId,
    campaignName,
    channel: p.channel as SocialChannel,
    format: p.format as SocialFormat,
    status: p.status as PostStatus,
    text: p.text,
    media: p.media ?? [],
    link: p.link,
    plannedAt: p.plannedAt?.toISOString() ?? null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    postUrl: p.postUrl,
    reach: p.reach,
    interactions: p.interactions,
    clicks: p.clicks,
    statsAt: p.statsAt?.toISOString() ?? null,
    notes: p.notes,
    overdue: isOverdue(p, now),
  };
}

const PHASE_ORDER: Record<CampaignPhase, number> = { RUNNING: 0, PLANNED: 1, OPEN: 2, DONE: 3 };

export async function loadSocialOverview(db: TenantDb, accountId: number, now: Date = new Date()): Promise<SocialOverview> {
  const today = berlinYmd(now);
  const soon = new Date(now.getTime() + UPCOMING_DAYS * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const [campaigns, posts, newsletterGroups, published] = await Promise.all([
    db.socialCampaign.findMany({
      where: { accountId },
      orderBy: [{ startsOn: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: { id: true, name: true, slug: true, startsOn: true, endsOn: true },
    }),
    db.socialPost.findMany({
      where: { accountId },
      select: { id: true, campaignId: true, status: true, plannedAt: true },
    }),
    db.newsletterCampaign.groupBy({
      by: ["socialCampaignId"],
      where: { accountId, socialCampaignId: { not: null } },
      _count: { _all: true },
    }),
    db.socialPost.aggregate({
      where: { accountId, status: "PUBLISHED", publishedAt: { gte: since30 } },
      _count: { _all: true },
      _sum: { reach: true },
    }),
  ]);

  const rows: SocialCampaignRow[] = campaigns.map((c) => {
    const own = posts.filter((p) => p.campaignId === c.id);
    const next = own
      .filter((p) => p.status !== "PUBLISHED" && p.plannedAt && p.plannedAt.getTime() >= now.getTime())
      .sort((a, b) => a.plannedAt!.getTime() - b.plannedAt!.getTime())[0];
    const startsOn = dateOnly(c.startsOn);
    const endsOn = dateOnly(c.endsOn);
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      phase: campaignPhase(startsOn, endsOn, today),
      period: periodLabel(startsOn, endsOn),
      posts: own.length,
      published: own.filter((p) => p.status === "PUBLISHED").length,
      overdue: own.filter((p) => isOverdue(p, now)).length,
      newsletters: newsletterGroups.find((g) => g.socialCampaignId === c.id)?._count._all ?? 0,
      nextPostAt: next?.plannedAt?.toISOString() ?? null,
    };
  });
  rows.sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase]);

  const upcomingIds = posts
    .filter((p) => p.status !== "PUBLISHED" && p.plannedAt && p.plannedAt.getTime() <= soon.getTime())
    .sort((a, b) => a.plannedAt!.getTime() - b.plannedAt!.getTime())
    .slice(0, 40)
    .map((p) => p.id);
  const upcomingFull = upcomingIds.length
    ? await db.socialPost.findMany({ where: { accountId, id: { in: upcomingIds } }, orderBy: { plannedAt: "asc" } })
    : [];
  const nameOf = new Map(campaigns.map((c) => [c.id, c.name]));

  return {
    campaigns: rows,
    upcoming: upcomingFull.map((p) => toPostRow(p, nameOf.get(p.campaignId) ?? "", now)),
    running: rows.filter((r) => r.phase === "RUNNING").length,
    plannedSoon: posts.filter((p) => p.status !== "PUBLISHED" && p.plannedAt && p.plannedAt >= now && p.plannedAt <= soon).length,
    overdue: posts.filter((p) => isOverdue(p, now)).length,
    published30: published._count._all,
    reach30: published._sum.reach ?? 0,
  };
}

export interface LinkedNewsletterRow {
  id: number;
  subject: string;
  status: CampaignStatus;
  /** ISO-Zeitpunkt: versendet, gestartet oder angelegt. */
  at: string;
  recipients: number;
  delivered: number;
  sent: number;
  unsubscribed: number;
}

export interface SocialCampaignDetail {
  campaign: {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    startsOn: string | null;
    endsOn: string | null;
    landingUrl: string | null;
    hashtags: string | null;
    createdBy: string | null;
    phase: CampaignPhase;
    period: string | null;
  };
  posts: SocialPostRow[];
  newsletters: LinkedNewsletterRow[];
  /** Aussendungen ohne Kampagne, zum Zuordnen. */
  unlinked: Array<{ id: number; subject: string; status: CampaignStatus }>;
}

export async function loadSocialCampaign(
  db: TenantDb,
  accountId: number,
  id: number,
  now: Date = new Date(),
): Promise<SocialCampaignDetail | null> {
  const c = await db.socialCampaign.findFirst({ where: { id, accountId } });
  if (!c) return null;
  const [posts, newsletters, unlinked] = await Promise.all([
    db.socialPost.findMany({
      where: { accountId, campaignId: id },
      orderBy: [{ plannedAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    }),
    db.newsletterCampaign.findMany({
      where: { accountId, socialCampaignId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, subject: true, status: true, createdAt: true, queuedAt: true, finishedAt: true },
    }),
    db.newsletterCampaign.findMany({
      where: { accountId, socialCampaignId: null },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, subject: true, status: true },
    }),
  ]);
  const ids = newsletters.map((n) => n.id);
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
  const startsOn = dateOnly(c.startsOn);
  const endsOn = dateOnly(c.endsOn);
  return {
    campaign: {
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      startsOn,
      endsOn,
      landingUrl: c.landingUrl,
      hashtags: c.hashtags,
      createdBy: c.createdBy,
      phase: campaignPhase(startsOn, endsOn, berlinYmd(now)),
      period: periodLabel(startsOn, endsOn),
    },
    posts: posts.map((p) => toPostRow(p, c.name, now)),
    newsletters: newsletters.map((n) => {
      const stats = campaignStats(
        sendGroups.filter((g) => g.campaignId === n.id).map((g) => ({ status: g.status, count: g._count._all })),
        unsubGroups.find((g) => g.campaignId === n.id)?._count._all ?? 0,
      );
      return {
        id: n.id,
        subject: n.subject,
        status: n.status as CampaignStatus,
        at: (n.finishedAt ?? n.queuedAt ?? n.createdAt).toISOString(),
        recipients: stats.total,
        delivered: stats.delivered,
        sent: stats.sent,
        unsubscribed: stats.unsubscribed,
      };
    }),
    unlinked: unlinked.map((u) => ({ id: u.id, subject: u.subject, status: u.status as CampaignStatus })),
  };
}
