import Link from "next/link";
import { ChartLine, Mail, MailCheck, Send, Tag, UserCheck, UserMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { NewsletterOverview } from "@/lib/newsletter/overview";
import { percent } from "@/lib/newsletter/stats";
import { campaignBadge } from "./campaign-ui";
import { GrowthChart } from "./growth-chart";

const nf = new Intl.NumberFormat("de-DE");

function shortDate(d: Date): string {
  return d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" });
}

/** Reiter „Übersicht“: Kennzahlen, Entwicklung, Gruppen, letzte Aussendungen. */
export function OverviewSection({
  overview,
  activeCount,
  pendingCount,
  unsubscribedCount,
  problemCount,
}: {
  overview: NewsletterOverview;
  activeCount: number;
  pendingCount: number;
  unsubscribedCount: number;
  problemCount: number;
}) {
  const { totals, change30, timeline, groups, recent } = overview;
  const growth = timeline.map((p) => ({ label: shortDate(p.end), active: p.active, joined: p.joined, left: p.left }));
  const failed = totals.bounced + totals.failed;
  const groupRows = [...groups].sort((a, b) => b.active - a.active);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <StatCard
          label="Angemeldet"
          value={nf.format(activeCount)}
          icon={UserCheck}
          tone="success"
          href="/newsletter?tab=abonnenten&status=ACTIVE"
          hint={`+${nf.format(change30.joined)} / −${nf.format(change30.left)} in 30 Tagen`}
        />
        <StatCard
          label="Aussendungen"
          value={overview.sentCampaigns}
          icon={Send}
          tone="primary"
          href="/newsletter?tab=aussendungen"
          hint={
            overview.lastSentLabel
              ? `zuletzt ${overview.lastSentLabel.split(",")[0]}`
              : overview.drafts
                ? `${overview.drafts} ${overview.drafts === 1 ? "Entwurf" : "Entwürfe"}`
                : "noch keine"
          }
        />
        <StatCard
          label="Zugestellt"
          value={percent(totals.delivered, totals.sent)}
          icon={MailCheck}
          tone="info"
          progress={totals.sent ? totals.delivered / totals.sent : undefined}
          hint={totals.sent ? `${nf.format(totals.delivered)} von ${nf.format(totals.sent)} Mails` : "noch keine Mails"}
        />
        <StatCard
          label="Abgemeldet über Mails"
          value={percent(totals.unsubscribed, totals.sent)}
          icon={UserMinus}
          tone="neutral"
          hint={totals.sent ? `${nf.format(totals.unsubscribed)} Abmeldungen, ${nf.format(failed)} unzustellbar` : "noch keine Mails"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3 lg:items-start">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ChartLine className="h-4 w-4 shrink-0 text-primary" />
              Entwicklung
            </CardTitle>
            <CardDescription>Angemeldete Abonnenten je Woche, die letzten 26 Wochen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-56 w-full" role="img" aria-label={`Angemeldete je Woche, zuletzt ${nf.format(growth.at(-1)?.active ?? 0)}`}>
              <GrowthChart data={growth} />
            </div>
            <p className="text-xs text-muted-foreground">
              Außerdem: {nf.format(pendingCount)} Bestätigung offen · {nf.format(unsubscribedCount)} abgemeldet ·{" "}
              {nf.format(problemCount)} unzustellbar oder Spam.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-4 w-4 shrink-0 text-primary" />
              Gruppen
            </CardTitle>
            <CardDescription>Angemeldete je Gruppe. Eine Adresse kann in mehreren sein.</CardDescription>
          </CardHeader>
          <CardContent>
            {groupRows.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Noch keine Gruppen.</p>
            ) : (
              <ul className="space-y-3">
                {groupRows.map((g) => {
                  const share = activeCount ? g.active / activeCount : 0;
                  return (
                    <li key={g.id}>
                      <Link href={`/newsletter?tab=abonnenten&gruppe=${g.id}`} className="group block space-y-1">
                        <span className="flex items-baseline justify-between gap-3 text-[13px]">
                          <span className="min-w-0 truncate font-medium text-foreground group-hover:underline">{g.name}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            <span className="font-semibold text-foreground">{nf.format(g.active)}</span> · {percent(g.active, activeCount)}
                          </span>
                        </span>
                        <span className="block h-1.5 overflow-hidden rounded-full bg-glass-tile ring-1 ring-inset ring-glass-border">
                          <span className="block h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${Math.round(share * 100)}%` }} />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card flush>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 shrink-0 text-primary" />
            Letzte Aussendungen
          </CardTitle>
          <CardDescription>Zugestellt laut Amazon SES. Öffnungen und Klicks zählt emp-access nicht.</CardDescription>
          <CardAction>
            <Button asChild variant="outline" className="max-sm:h-11">
              <Link href="/newsletter?tab=aussendungen">Alle</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Aussendung</TableHead>
              <TableHead className="text-right">Empfänger</TableHead>
              <TableHead className="text-right">Zugestellt</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Unzustellbar</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Abgemeldet</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.length === 0 && (
              // Symbol nicht an TableEmpty geben: table.tsx ist eine Client-Komponente,
              // Funktionen (Lucide-Icons) dürfen von hier aus nicht hinüber.
              <TableEmpty colSpan={5}>
                <EmptyState icon={Send} title="Noch nichts versendet." description="Gestartete Aussendungen erscheinen hier mit ihren Zahlen." compact />
              </TableEmpty>
            )}
            {recent.map((c) => (
              <TableRow key={c.id} className="max-sm:h-11">
                <TableCell className="max-w-0 w-full whitespace-normal">
                  <Link href={`/newsletter/${c.id}`} className="break-words font-medium text-foreground hover:underline">
                    {c.subject}
                  </Link>
                  <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    {c.status !== "SENT" && (
                      <Badge variant={campaignBadge(c.status)} className="font-normal">
                        {c.statusLabel}
                      </Badge>
                    )}
                    <span>
                      {c.dateLabel ?? ""} · an {c.groupNames.length ? c.groupNames.join(", ") : "alle"}
                    </span>
                    <span className="sm:hidden">
                      · {nf.format(c.stats.bounced + c.stats.failed)} unzustellbar · {nf.format(c.stats.unsubscribed)} abgemeldet
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{nf.format(c.stats.total)}</TableCell>
                <TableCell className="text-right tabular-nums">{percent(c.stats.delivered, c.stats.sent)}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  {percent(c.stats.bounced + c.stats.failed, c.stats.sent + c.stats.failed)}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{percent(c.stats.unsubscribed, c.stats.sent)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
