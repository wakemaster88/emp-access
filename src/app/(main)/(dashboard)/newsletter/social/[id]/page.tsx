import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, Eye, Heart, MailCheck } from "lucide-react";
import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { isTenantAdminRole } from "@/lib/api-auth";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { loadSocialCampaign } from "@/lib/social/load";
import type { SocialChannel } from "@/lib/social/rules";
import { CampaignCard } from "@/components/social/campaign-card";
import { PostsCard } from "@/components/social/posts-card";
import { NewslettersCard } from "@/components/social/newsletters-card";
import { LinksCard } from "@/components/social/links-card";
import { nf } from "@/components/social/social-ui";

export const dynamic = "force-dynamic";

export default async function SocialCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ beitrag?: string }>;
}) {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  const accountId = session.user.accountId;
  if (!accountId || !isTenantAdminRole(session.user.role)) redirect("/");

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const detail = await loadSocialCampaign(tenantClient(accountId), accountId, id);
  if (!detail) notFound();
  const { campaign, posts, newsletters, unlinked } = detail;
  const openPost = Number((await searchParams).beitrag);

  const published = posts.filter((p) => p.status === "PUBLISHED");
  const sum = (key: "reach" | "interactions" | "clicks") => published.reduce((s, p) => s + (p[key] ?? 0), 0);
  const withStats = published.filter((p) => p.reach !== null || p.interactions !== null).length;
  const delivered = newsletters.reduce((s, n) => s + n.delivered, 0);
  const sentMails = newsletters.filter((n) => n.status !== "DRAFT").length;
  const usedChannels = [...new Set(posts.map((p) => p.channel))] as SocialChannel[];
  const clicks = sum("clicks");

  return (
    <>
      <Header title="Newsletter" accountName={session.user.accountName} />
      <div className="page-content space-y-4 sm:space-y-5">
        <Button asChild variant="ghost" size="sm" className="-ml-2 max-sm:h-11">
          <Link href="/newsletter?tab=social">
            <ArrowLeft className="h-4 w-4" />
            Social Media
          </Link>
        </Button>

        <CampaignCard campaign={campaign} postCount={posts.length} newsletterCount={newsletters.length} />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <StatCard
            label="Gepostet"
            value={published.length}
            suffix={`von ${posts.length}`}
            icon={CheckCircle2}
            tone="success"
            progress={posts.length ? published.length / posts.length : undefined}
          />
          <StatCard
            label="Erreicht"
            value={nf.format(sum("reach"))}
            icon={Eye}
            tone="info"
            hint={withStats ? `aus ${withStats} ${withStats === 1 ? "Beitrag" : "Beiträgen"}` : "Zahlen nach dem Posten eintragen"}
          />
          <StatCard
            label="Interaktionen"
            value={nf.format(sum("interactions"))}
            icon={Heart}
            tone="primary"
            hint={clicks ? `${nf.format(clicks)} Link-Klicks` : "Likes, Kommentare, Teilen"}
          />
          <StatCard
            label="Newsletter zugestellt"
            value={nf.format(delivered)}
            icon={MailCheck}
            tone="neutral"
            hint={sentMails ? `${sentMails} ${sentMails === 1 ? "Aussendung" : "Aussendungen"}` : "noch keine verschickt"}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3 lg:items-start">
          <div className="min-w-0 lg:col-span-2">
            <PostsCard
              campaign={{ id: campaign.id, slug: campaign.slug, landingUrl: campaign.landingUrl, hashtags: campaign.hashtags }}
              posts={posts}
              openPostId={Number.isInteger(openPost) && openPost > 0 ? openPost : null}
            />
          </div>
          <div className="min-w-0 space-y-4 sm:space-y-5">
            <NewslettersCard campaignId={campaign.id} newsletters={newsletters} unlinked={unlinked} />
            <LinksCard landingUrl={campaign.landingUrl} slug={campaign.slug} usedChannels={usedChannels} />
          </div>
        </div>
      </div>
    </>
  );
}
