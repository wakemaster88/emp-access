import Link from "next/link";
import { AlarmClock, CalendarClock, CalendarDays, CheckCircle2, Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { StatCard } from "@/components/ui/stat-card";
import { UPCOMING_DAYS, type SocialOverview as Overview, type SocialPostRow } from "@/lib/social/load";
import { CHANNEL_LABEL, FORMAT_LABEL, POST_STATUS_LABEL } from "@/lib/social/rules";
import { CHANNEL_ICON, dayLabel, excerpt, nf, postBadge, timeLabel, whenLabel } from "./social-ui";
import { SocialCampaignsCard } from "./campaigns-card";
import { MetaCard } from "./meta-card";
import type { MetaStatus } from "@/lib/social/meta-store";

/** Reiter „Social Media“: Kennzahlen, Kampagnen, nächste Beiträge über alle Kampagnen. */
export function SocialOverview({
  overview,
  websiteUrl,
  meta,
  metaResult,
}: {
  overview: Overview;
  websiteUrl: string | null;
  meta: MetaStatus;
  metaResult: string | null;
}) {
  const groups = new Map<string, SocialPostRow[]>();
  for (const p of overview.upcoming) {
    const key = p.overdue ? "Überfällig" : dayLabel(p.plannedAt!);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <StatCard
          label="Kampagnen"
          value={overview.running}
          icon={Megaphone}
          tone="primary"
          hint={`${overview.running === 1 ? "läuft" : "laufen"} gerade · ${overview.campaigns.length} insgesamt`}
        />
        <StatCard label="Geplant" value={overview.plannedSoon} icon={CalendarClock} tone="info" hint={`nächste ${UPCOMING_DAYS} Tage`} />
        <StatCard
          label="Überfällig"
          value={overview.overdue}
          icon={AlarmClock}
          tone={overview.overdue ? "danger" : "neutral"}
          hint={overview.overdue ? "Termin vorbei, nicht gepostet" : "nichts liegen geblieben"}
        />
        <StatCard
          label="Veröffentlicht"
          value={overview.published30}
          icon={CheckCircle2}
          tone="success"
          hint={overview.reach30 ? `30 Tage · ${nf.format(overview.reach30)} erreicht` : "letzte 30 Tage"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3 lg:items-start">
        <div className="min-w-0 lg:col-span-2">
          <SocialCampaignsCard campaigns={overview.campaigns} websiteUrl={websiteUrl} />
        </div>

        <div className="min-w-0 space-y-4 sm:space-y-5">
          <MetaCard status={meta} result={metaResult} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
                Nächste Beiträge
              </CardTitle>
              <CardDescription>
                Alle Kampagnen, die nächsten {UPCOMING_DAYS} Tage.{" "}
                {meta.connected ? "Mit „automatisch“ markierte Beiträge postet emp-access selbst." : "Gepostet wird von Hand."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {overview.upcoming.length === 0 ? (
                <EmptyState
                  icon={CalendarDays}
                  size="sm"
                  title="Nichts geplant"
                  description="Plane Beiträge in einer Kampagne mit Termin, dann stehen sie hier."
                />
              ) : (
                <div className="space-y-4">
                  {[...groups.entries()].map(([day, posts]) => (
                    <section key={day} className="space-y-2">
                      <h3 className={day === "Überfällig" ? "text-label text-destructive" : "text-label"}>{day}</h3>
                      <ul className="space-y-2">
                        {posts.map((p) => (
                          <li key={p.id}>
                            <Link
                              href={`/newsletter/social/${p.campaignId}?beitrag=${p.id}`}
                              className="glass-tile press flex min-h-11 items-start gap-3 px-3 py-2.5 hover:bg-glass-strong"
                            >
                              <IconChip icon={CHANNEL_ICON[p.channel]} tone="primary" size="sm" label={CHANNEL_LABEL[p.channel]} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium text-foreground">
                                  {excerpt(p.text, 70) || `${FORMAT_LABEL[p.format]} auf ${CHANNEL_LABEL[p.channel]}`}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {p.overdue ? whenLabel(p.plannedAt) : timeLabel(p.plannedAt!)} · {p.campaignName}
                                  {p.autoPublish ? " · automatisch" : ""}
                                </span>
                              </span>
                              <Badge variant={postBadge(p.status, p.overdue)} className="shrink-0 font-normal">
                                {POST_STATUS_LABEL[p.status]}
                              </Badge>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
