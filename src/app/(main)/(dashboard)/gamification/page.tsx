import { redirect } from "next/navigation";
import { Award, BarChart3, CalendarCheck, Gift, Megaphone, Play, Settings, Trophy, Users } from "lucide-react";
import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { isTenantAdminRole } from "@/lib/api-auth";
import { berlinHm, berlinYmd } from "@/lib/berlin-day";
import {
  benefitVoucherState, challengePhase, dbDateToYmd, milestoneConditionText, offerVisible, parsePriceMap,
  periodKey, ymdToDbDate, ALL_TIME_KEY, TIER_LABEL,
  type GamiMetric, type GamiPeriod, type GamiTier,
} from "@/lib/gamification";
import { awardReach, bucketize, groupPersonDays, monthRows } from "@/lib/gamification-stats";
import { challengeUnits, settleDueChallenges, type ChallengeRow } from "@/lib/challenge-service";
import { loadVoting } from "@/lib/challenge-voting";
import { Header } from "@/components/layout/header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { MilestonesCard, type MilestoneRow } from "@/components/gamification/milestones-card";
import { loadOpeningDays, loadWaterNow, toMilestoneRule } from "@/lib/gamification-service";
import { BenefitVouchersCard, type BenefitVoucherRow } from "@/components/gamification/benefit-vouchers-card";
import { RidersCard, type RiderRow } from "@/components/gamification/riders-card";
import { DayGuestMailsCard, type DayGuestMailRow } from "@/components/gamification/day-guest-mails-card";
import { ChallengesCard, type ChallengeAdminRow } from "@/components/gamification/challenges-card";
import { OffersCard, type OfferAdminRow } from "@/components/gamification/offers-card";
import { riderPushReach } from "@/lib/rider-announce";
import { HolidaysCard, type HolidayAdminRow } from "@/components/gamification/holidays-card";
import { addDaysYmd, upcomingHolidays } from "@/lib/holidays";
import { BirthdayCard, type BirthdayAdminData } from "@/components/gamification/birthday-card";
import { isBirthdayOn } from "@/lib/birthday";
import { GamiSettingsCard } from "@/components/gamification/gami-settings-card";
import { AppShareCard } from "@/components/gamification/app-share-card";
import { OccupancySettingsCard } from "@/components/gamification/occupancy-settings-card";
import { BeachSettingsCard } from "@/components/gamification/beach-settings-card";
import { BeachPassCard } from "@/components/gamification/beach-pass-card";
import { beachEntranceIds } from "@/lib/beach-occupancy";
import { normalizeBeachSettings } from "@/lib/beach-occupancy";
import { normalizeThresholds } from "@/lib/rider-occupancy";
import { AppInviteCard } from "@/components/gamification/app-invite-card";
import { MusicVoteCard } from "@/components/gamification/music-vote-card";
import { loadMusicVoteAdmin } from "@/lib/music-vote";
import { inviteStatus } from "@/lib/rider-invite";
import { SkillsCard, type SkillAdminRow, type SkillUseRow } from "@/components/gamification/skills-card";
import { isSkillDevice } from "@/lib/rider-skill-rules";

type Tab = "auswertung" | "fahrer" | "meilensteine" | "aktionen" | "gutscheine" | "einstellungen";
const TABS: Tab[] = ["auswertung", "fahrer", "meilensteine", "aktionen", "gutscheine", "einstellungen"];
/** Alte Links (?tab=challenges, ?tab=angebote) führen in den gemeinsamen Reiter „Aktionen“. */
const LEGACY_TABS: Record<string, Tab> = { challenges: "aktionen", angebote: "aktionen" };

function ticketLabel(t: { name: string; firstName: string | null; lastName: string | null }): string {
  const full = [t.firstName, t.lastName].filter(Boolean).join(" ").trim();
  return full || t.name;
}

export default async function GamificationPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  const accountId = session.user.accountId;
  // Einstellungen gelten je Mandant und sind Sache der Verwaltung.
  if (!accountId || !isTenantAdminRole(session.user.role)) redirect("/");

  const { tab: rawTab } = await searchParams;
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : LEGACY_TABS[rawTab ?? ""] ?? "auswertung";
  const db = tenantClient(accountId);
  const year = Number(berlinYmd(new Date()).slice(0, 4));
  const yearRange = { gte: ymdToDbDate(`${year}-01-01`), lte: ymdToDbDate(`${year}-12-31`) };

  const config = await db.gamificationConfig.findUnique({ where: { accountId } });

  const tabs = (
    <SegmentedLinks
      aria-label="Kunden App"
      className="max-sm:[&_svg]:hidden"
      value={tab}
      options={[
        { value: "auswertung", label: "Übersicht", icon: BarChart3, href: "/gamification" },
        { value: "fahrer", label: "Fahrer", icon: Users, href: "/gamification?tab=fahrer" },
        { value: "meilensteine", label: "Awards", icon: Award, href: "/gamification?tab=meilensteine" },
        { value: "aktionen", label: "Aktionen", icon: Megaphone, href: "/gamification?tab=aktionen" },
        { value: "gutscheine", label: "Gutscheine", icon: Gift, href: "/gamification?tab=gutscheine" },
        { value: "einstellungen", label: "Einstellungen", icon: Settings, href: "/gamification?tab=einstellungen" },
      ]}
    />
  );

  let content: React.ReactNode = null;

  // Skills zur Wahl als Belohnung (Awards, Challenges, Feiertage).
  const skillChoices =
    tab === "meilensteine" || tab === "aktionen"
      ? await db.riderSkill.findMany({
          where: { accountId, active: true },
          select: { id: true, name: true },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        })
      : [];
  const skillName = new Map(skillChoices.map((k) => [k.id, k.name]));

  if (tab === "auswertung") {
    const subscriptionIds = config?.subscriptionIds ?? [];
    const capPerDay = config?.startCapPerDay ?? 10;
    const todayYmd = berlinYmd(new Date());
    const [stats, milestones, awardRows, openVouchers, redeemedVouchers, legacyDevice, openingDays] = await Promise.all([
      // Alle Jahre: Awards ohne Zeitraum zählen über die ganze Zeit.
      subscriptionIds.length
        ? db.riderDayStat.findMany({
            where: { accountId, ticket: { subscriptionId: { in: subscriptionIds }, NOT: { name: { startsWith: "TEST:" } } } },
            select: { ticketId: true, day: true, starts: true },
          })
        : Promise.resolve([]),
      db.milestone.findMany({
        where: { accountId, active: true, audience: { in: ["RIDE", "ALL"] } },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      }),
      db.milestoneAward.findMany({
        where: { accountId, milestone: { active: true } },
        select: { milestoneId: true, ticketId: true, periodKey: true },
      }),
      db.voucher.count({
        where: {
          accountId, kind: "BENEFIT", redeemedAt: null, disabledAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        },
      }),
      db.voucher.count({ where: { accountId, kind: "BENEFIT", redeemedAt: { not: null } } }),
      db.device.findFirst({
        where: { accountId, legacyStartsUntil: { not: null } },
        select: { name: true, legacyStartsUntil: true },
        orderBy: { legacyStartsUntil: "desc" },
      }),
      loadOpeningDays(db, accountId, [String(year)]),
    ]);

    // Je Person zählen wie bei den Awards: Profil, sonst das Ticket.
    const ticketIds = [...new Set([...stats.map((r) => r.ticketId), ...awardRows.map((a) => a.ticketId)])];
    const tickets = ticketIds.length
      ? await db.ticket.findMany({
          where: { accountId, id: { in: ticketIds } },
          select: {
            id: true, name: true, firstName: true, lastName: true, riderProfileId: true,
            riderProfile: { select: { ridingSince: true } },
          },
        })
      : [];
    const personOf = new Map(tickets.map((t) => [t.id, t.riderProfileId != null ? `p${t.riderProfileId}` : `t${t.id}`]));
    const nameOf = new Map<string, string>();
    const ridingSince = new Map<string, number | null>();
    for (const t of tickets) {
      const key = personOf.get(t.id)!;
      if (!nameOf.has(key)) nameOf.set(key, ticketLabel(t));
      if (t.riderProfile?.ridingSince != null) ridingSince.set(key, t.riderProfile.ridingSince);
    }
    const persons = groupPersonDays(
      stats.map((r) => ({ person: personOf.get(r.ticketId) ?? `t${r.ticketId}`, day: dbDateToYmd(r.day), starts: r.starts })),
      ridingSince,
    );
    const yearKey = String(year);
    const season = persons
      .map((p) => {
        const days = p.days.filter((d) => d.day.startsWith(yearKey) && d.starts > 0);
        return {
          key: p.key,
          visitDays: days.length,
          starts: days.reduce((sum, d) => sum + Math.min(d.starts, capPerDay), 0),
          allStarts: p.days.reduce((sum, d) => sum + Math.min(d.starts, capPerDay), 0),
        };
      })
      .filter((p) => p.visitDays > 0)
      .sort((a, b) => b.visitDays - a.visitDays || b.starts - a.starts);
    const active = season.length;
    const totalDays = season.reduce((s, r) => s + r.visitDays, 0);
    const totalStarts = season.reduce((s, r) => s + r.starts, 0);
    const median = (values: number[]) => {
      if (values.length === 0) return 0;
      const v = [...values].sort((a, b) => a - b);
      const mid = Math.floor(v.length / 2);
      return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
    };

    const rules = milestones.map(toMilestoneRule);
    const reach = new Map(awardReach(persons, rules, todayYmd, capPerDay, openingDays).map((r) => [r.milestoneId, r.reached]));
    const awardedPersons = new Map<number, Set<string>>();
    const awardsThisYear = awardRows.filter((a) => a.periodKey === yearKey || a.periodKey === ALL_TIME_KEY);
    for (const a of awardRows) {
      const m = milestones.find((x) => x.id === a.milestoneId);
      if (!m || a.periodKey !== periodKey(m.period as GamiPeriod, todayYmd)) continue;
      const set = awardedPersons.get(a.milestoneId) ?? new Set<string>();
      set.add(personOf.get(a.ticketId) ?? `t${a.ticketId}`);
      awardedPersons.set(a.milestoneId, set);
    }
    const share = (n: number) => (active > 0 ? `${Math.round((n / active) * 100)} %` : "–");

    const thresholdsOf = (metric: string) => milestones.filter((m) => m.metric === metric).map((m) => m.threshold);
    const dayBuckets = bucketize(season.map((r) => r.visitDays), [1, ...thresholdsOf("VISIT_DAYS")], "Tage");
    const startBuckets = bucketize(season.map((r) => r.allStarts), [1, ...thresholdsOf("STARTS")], "Starts");
    const months = monthRows(persons, yearKey, capPerDay);
    const monthName = (ym: string) =>
      new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("de-DE", { month: "long", timeZone: "Europe/Berlin" });
    const top = season.slice(0, 20);
    const legacyUntil = legacyDevice?.legacyStartsUntil ? berlinYmd(new Date(legacyDevice.legacyStartsUntil.getTime() - 1)) : null;
    const fmtYmd = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;

    content = (
      <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Aktive Fahrer" value={active} icon={Users} hint={`Saison ${year}, je Person`} />
          <StatCard label="Besuchstage" value={totalDays} icon={CalendarCheck} tone="info" hint={`Median ${median(season.map((r) => r.visitDays))} je Fahrer`} />
          <StatCard label="Starts" value={totalStarts} icon={Play} tone="success" hint={`Median ${median(season.map((r) => r.starts))} je Fahrer`} />
          <StatCard label="Awards vergeben" value={awardsThisYear.length} icon={Trophy} tone="violet" hint={`${openVouchers} Gutscheine offen, ${redeemedVouchers} eingelöst`} />
        </div>
        {legacyDevice && legacyUntil && (
          <Notice tone="info" compact title={`Bis ${fmtYmd(legacyUntil)} zählt „${legacyDevice.name}“`}>
            Dort wurde nur ein Teil der Starts gescannt. Besuchstage stimmen, Starts aus dieser Zeit sind eine Untergrenze.
          </Notice>
        )}
        <Card flush>
          <CardHeader>
            <CardTitle>Wer welchen Award schafft</CardTitle>
            <CardDescription>
              Erreicht: Personen, die das Ziel heute erfüllen (Saison {year} oder insgesamt). Anteil von {active} aktiven Fahrern.
            </CardDescription>
          </CardHeader>
          <Table edge>
            <TableHeader>
              <TableRow>
                <TableHead>Award</TableHead>
                <TableHead className="max-sm:hidden">Ziel</TableHead>
                <TableHead className="text-right">Erreicht</TableHead>
                <TableHead className="text-right max-sm:hidden">Anteil</TableHead>
                <TableHead className="text-right">Vergeben</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {milestones.length === 0 && <TableEmpty colSpan={5} title="Keine aktiven Awards." />}
              {milestones.map((m) => {
                const reached = reach.get(m.id) ?? null;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="max-sm:whitespace-normal">
                      <span className="font-medium">{m.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {TIER_LABEL[m.tier as GamiTier]}
                        <span className="sm:hidden"> · {milestoneConditionText({ metric: m.metric as GamiMetric, threshold: m.threshold, period: m.period as GamiPeriod, tempBelow: m.tempBelow })}</span>
                      </span>
                    </TableCell>
                    <TableCell className="max-sm:hidden">
                      {milestoneConditionText({ metric: m.metric as GamiMetric, threshold: m.threshold, period: m.period as GamiPeriod, tempBelow: m.tempBelow })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {reached ?? "–"}
                      {reached != null && <span className="block text-xs text-muted-foreground sm:hidden">{share(reached)}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums max-sm:hidden">{reached != null ? share(reached) : "–"}</TableCell>
                    <TableCell className="text-right tabular-nums">{awardedPersons.get(m.id)?.size ?? 0}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
          <Card flush>
            <CardHeader>
              <CardTitle>Besuchstage je Fahrer</CardTitle>
              <CardDescription>Saison {year}, Stufen nach den Award-Zielen.</CardDescription>
            </CardHeader>
            <Table edge>
              <TableBody>
                {dayBuckets.map((b) => (
                  <TableRow key={b.label}>
                    <TableCell>{b.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.count}</TableCell>
                    <TableCell className="w-16 text-right tabular-nums text-muted-foreground">{share(b.count)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Card flush>
            <CardHeader>
              <CardTitle>Starts je Fahrer</CardTitle>
              <CardDescription>Insgesamt, höchstens {capPerDay} je Tag, wie bei den Awards.</CardDescription>
            </CardHeader>
            <Table edge>
              <TableBody>
                {startBuckets.map((b) => (
                  <TableRow key={b.label}>
                    <TableCell>{b.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.count}</TableCell>
                    <TableCell className="w-16 text-right tabular-nums text-muted-foreground">{share(b.count)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
          <Card flush>
            <CardHeader>
              <CardTitle>Saison {year} je Monat</CardTitle>
              <CardDescription>Fahrer, Besuchstage und Starts.</CardDescription>
            </CardHeader>
            <Table edge>
              <TableHeader>
                <TableRow>
                  <TableHead>Monat</TableHead>
                  <TableHead className="text-right">Fahrer</TableHead>
                  <TableHead className="text-right">Tage</TableHead>
                  <TableHead className="text-right">Starts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.length === 0 && <TableEmpty colSpan={4} title="Noch keine Besuchstage gezählt." />}
                {months.map((r) => (
                  <TableRow key={r.month}>
                    <TableCell>{monthName(r.month)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.persons}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.visitDays}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.starts}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Card flush>
            <CardHeader>
              <CardTitle>Meiste Besuchstage</CardTitle>
              <CardDescription>Top 20 der Saison {year}. Nur hier in der Verwaltung sichtbar.</CardDescription>
            </CardHeader>
            <Table edge>
              <TableHeader>
                <TableRow>
                  <TableHead>Fahrer</TableHead>
                  <TableHead className="text-right">Tage</TableHead>
                  <TableHead className="text-right">Starts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.length === 0 && <TableEmpty colSpan={3} title="Noch keine Besuchstage gezählt." />}
                {top.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="max-sm:whitespace-normal">{nameOf.get(r.key) ?? "Unbekannt"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.visitDays}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.starts}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      </>
    );
  }

  if (tab === "fahrer") {
    const subscriptionIds = config?.subscriptionIds ?? [];
    const [tickets, perTicket, subscriptions] = await Promise.all([
      subscriptionIds.length
        ? db.ticket.findMany({
            where: { accountId, subscriptionId: { in: subscriptionIds }, status: "VALID" },
            select: {
              id: true, name: true, firstName: true, lastName: true, subscriptionId: true,
              rfidCode: true, birthDate: true, gamificationOptOut: true,
              riderProfile: { select: { lastSeenAt: true } },
            },
            orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
            take: 2000,
          })
        : Promise.resolve([]),
      db.riderDayStat.groupBy({
        by: ["ticketId"],
        where: { accountId, day: yearRange },
        _count: { _all: true },
        _sum: { starts: true },
      }),
      db.subscription.findMany({ where: { accountId }, select: { id: true, name: true } }),
    ]);
    const statById = new Map(perTicket.map((r) => [r.ticketId, r]));
    const subName = new Map(subscriptions.map((s) => [s.id, s.name]));
    const rows: RiderRow[] = tickets.map((t) => ({
      ticketId: t.id,
      name: ticketLabel(t),
      subscription: t.subscriptionId != null ? subName.get(t.subscriptionId) ?? "Abo" : "Abo",
      visitDays: statById.get(t.id)?._count._all ?? 0,
      starts: statById.get(t.id)?._sum.starts ?? 0,
      appUsed: t.riderProfile?.lastSeenAt != null,
      optOut: t.gamificationOptOut,
      canSelfLogin: Boolean(t.rfidCode && t.birthDate),
    }));
    // Tagesgäste: Adressen der Tagestickets dieser Saison, je Adresse eine Zeile.
    const dayServiceIds = config?.dayServiceIds ?? [];
    // Großzügig laden (Zeitzone), unten zählt der Berliner Kalendertag.
    const seasonSpan = { gte: new Date(Date.UTC(year - 1, 11, 31)), lt: new Date(Date.UTC(year + 1, 0, 2)) };
    let dayGuests: { rows: DayGuestMailRow[]; withoutEmail: number; mailReady: boolean } | null = null;
    if (dayServiceIds.length > 0) {
      const [dayTickets, mail] = await Promise.all([
        db.ticket.findMany({
          where: {
            accountId, subscriptionId: null, serviceId: { in: dayServiceIds }, status: { in: ["VALID", "REDEEMED"] },
            OR: [{ startDate: seasonSpan }, { startDate: null, createdAt: seasonSpan }],
          },
          select: { email: true, startDate: true, createdAt: true, riderProfileId: true },
          take: 20000,
        }),
        db.emailConfig.findUnique({ where: { accountId }, select: { isActive: true, apiKey: true } }),
      ]);
      const byMail = new Map<string, DayGuestMailRow>();
      let withoutEmail = 0;
      for (const t of dayTickets) {
        const day = berlinYmd(t.startDate ?? t.createdAt);
        if (!day.startsWith(String(year))) continue;
        const email = t.email?.trim().toLowerCase();
        if (!email) {
          withoutEmail += 1;
          continue;
        }
        const row = byMail.get(email) ?? { email, tickets: 0, lastDay: day, inApp: false };
        row.tickets += 1;
        if (day > row.lastDay) row.lastDay = day;
        if (t.riderProfileId != null) row.inApp = true;
        byMail.set(email, row);
      }
      dayGuests = {
        rows: [...byMail.values()].sort((a, b) => b.lastDay.localeCompare(a.lastDay) || a.email.localeCompare(b.email)),
        withoutEmail,
        mailReady: Boolean(mail?.isActive && mail.apiKey),
      };
    }
    content = (
      <div className="space-y-4 sm:space-y-5">
        {dayGuests && <DayGuestMailsCard rows={dayGuests.rows} year={year} withoutEmail={dayGuests.withoutEmail} mailReady={dayGuests.mailReady} />}
        <RidersCard riders={rows} year={year} />
      </div>
    );
  }

  if (tab === "meilensteine") {
    const [milestones, awardCounts, redeemedAwards, openingDays, sensor, waterNow] = await Promise.all([
      db.milestone.findMany({ where: { accountId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
      db.milestoneAward.groupBy({ by: ["milestoneId"], where: { accountId }, _count: { _all: true } }),
      db.milestoneAward.groupBy({
        by: ["milestoneId"],
        where: { accountId, voucher: { redeemedAt: { not: null } } },
        _count: { _all: true },
      }),
      loadOpeningDays(db, accountId, [String(year)]),
      config?.waterSensorDeviceId != null
        ? db.device.findFirst({ where: { id: config.waterSensorDeviceId, accountId }, select: { name: true } })
        : null,
      loadWaterNow(accountId).catch(() => null),
    ]);
    const awarded = new Map(awardCounts.map((a) => [a.milestoneId, a._count._all]));
    const redeemed = new Map(redeemedAwards.map((a) => [a.milestoneId, a._count._all]));
    const rows: MilestoneRow[] = milestones.map((m) => ({
      id: m.id,
      name: m.name,
      metric: m.metric as GamiMetric,
      threshold: m.threshold,
      period: m.period as GamiPeriod,
      voucherLabel: m.voucherLabel,
      voucherValidDays: m.voucherValidDays,
      voucherShort: m.voucherShort,
      bonus: m.bonus,
      tier: m.tier as GamiTier,
      hint: m.hint,
      eventDays: m.eventDays.map(dbDateToYmd),
      tempBelow: m.tempBelow,
      skillId: m.skillId,
      skillUses: m.skillUses,
      skillValidDays: m.skillValidDays,
      skillName: m.skillId != null ? skillName.get(m.skillId) ?? null : null,
      active: m.active,
      audience: m.audience,
      awarded: awarded.get(m.id) ?? 0,
      redeemed: redeemed.get(m.id) ?? 0,
    }));
    content = (
      <MilestonesCard
        milestones={rows}
        today={berlinYmd(new Date())}
        openingDay={openingDays[String(year)] ?? null}
        waterSensor={sensor ? { name: sensor.name, now: waterNow } : null}
        skills={skillChoices}
        beachEnabled={config?.beachEnabled ?? false}
      />
    );
  }

  if (tab === "aktionen") {
    const today = berlinYmd(new Date());
    const cap = config?.startCapPerDay ?? 10;
    // Beendete Top-X-Challenges auswerten, auch wenn seit dem Ende niemand gestartet ist.
    if (config?.enabled) await settleDueChallenges(db, accountId, today, cap);
    const [challenges, winners] = await Promise.all([
      db.challenge.findMany({ where: { accountId }, orderBy: [{ endDate: "desc" }, { id: "desc" }], take: 100 }),
      db.challengeAward.groupBy({ by: ["challengeId"], where: { accountId }, _count: { _all: true } }),
    ]);
    const winnersById = new Map(winners.map((w) => [w.challengeId, w._count._all]));
    const phaseOf = (c: { startDate: Date; endDate: Date; endTime: string | null }) =>
      challengePhase({ startYmd: dbDateToYmd(c.startDate), endYmd: dbDateToYmd(c.endDate), endTime: c.endTime }, today, berlinHm());
    const voting = await loadVoting(
      accountId,
      challenges.map((c) => ({ id: c.id, kind: c.kind, phase: phaseOf(c), topCount: c.topCount })),
      null,
      true,
    );
    const challengeRows: ChallengeAdminRow[] = [];
    for (const c of challenges) {
      const startDate = dbDateToYmd(c.startDate);
      const endDate = dbDateToYmd(c.endDate);
      const phase = phaseOf(c);
      const v = voting.get(c.id);
      const units = phase === "upcoming" ? [] : await challengeUnits(db, accountId, c as ChallengeRow, cap);
      challengeRows.push({
        id: c.id,
        name: c.name,
        description: c.description,
        kind: c.kind,
        metric: c.metric as GamiMetric,
        threshold: c.threshold,
        topCount: c.topCount,
        startDate,
        endDate,
        endTime: c.endTime,
        voucherLabel: c.voucherLabel,
        voucherValidDays: c.voucherValidDays,
        skillId: c.skillId,
        skillUses: c.skillUses,
        skillValidDays: c.skillValidDays,
        active: c.active,
        audience: c.audience,
        settled: c.settledAt != null,
        phase,
        participants:
          c.kind === "PHOTO" ? (v?.entries.filter((e) => !e.hidden).length ?? 0)
          : c.kind === "POLL" ? (v?.totalVotes ?? 0)
          : units.filter((u) => u.value > 0).length,
        winners: winnersById.get(c.id) ?? 0,
        options: v?.options.map((o) => ({ label: o.label, votes: o.votes ?? 0, percent: o.percent ?? 0 })) ?? [],
        entries: v?.entries.map((e) => ({ id: e.id, name: e.name, votes: e.votes ?? 0, rank: e.rank, hidden: e.hidden })) ?? [],
        started: (v?.entries.length ?? 0) > 0 || (v?.totalVotes ?? 0) > 0,
        pushPlanned: c.pushPlanned,
        pushedAt: c.pushedAt?.toISOString() ?? null,
        pushSent: c.pushSent,
      });
    }
    const [offers, reach, holidaySettings, holidayGifts, birthdaySetting, birthDates, birthdayYear] = await Promise.all([
      db.riderOffer.findMany({
        where: { accountId },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        take: 200,
      }),
      riderPushReach(accountId),
      db.riderHoliday.findMany({ where: { accountId } }),
      db.riderHolidayGift.groupBy({ by: ["holidayId"], where: { accountId }, _count: { _all: true } }),
      db.riderBirthday.findUnique({ where: { accountId } }),
      db.riderProfile.findMany({ where: { accountId, birthDate: { not: null } }, select: { birthDate: true } }),
      db.riderBirthdayGift.findMany({
        where: { accountId, year: Number(today.slice(0, 4)) },
        select: { voucherId: true, pushedAt: true },
      }),
    ]);
    const weekDays = Array.from({ length: 7 }, (_, i) => addDaysYmd(today, i + 1));
    const birthday: BirthdayAdminData = {
      setting: birthdaySetting
        ? {
            active: birthdaySetting.active,
            title: birthdaySetting.title,
            text: birthdaySetting.text,
            voucherLabel: birthdaySetting.voucherLabel,
            voucherValidDays: birthdaySetting.voucherValidDays,
            pushPlanned: birthdaySetting.pushPlanned,
            announceActive: birthdaySetting.announceActive,
          }
        : null,
      today: birthDates.filter((p) => isBirthdayOn(p.birthDate, today)).length,
      week: birthDates.filter((p) => weekDays.some((d) => isBirthdayOn(p.birthDate, d))).length,
      known: birthDates.length,
      giftsYear: birthdayYear.filter((g) => g.voucherId != null).length,
      pushesYear: birthdayYear.filter((g) => g.pushedAt != null).length,
    };
    const settingByKey = new Map(holidaySettings.map((h) => [h.key, h]));
    const giftsById = new Map(holidayGifts.map((g) => [g.holidayId, g._count._all]));
    const holidayRows: HolidayAdminRow[] = upcomingHolidays(today).map((h) => {
      const s = settingByKey.get(h.key);
      return {
        ...h,
        setting: s
          ? {
              show: s.show,
              title: s.title,
              text: s.text,
              voucherLabel: s.voucherLabel,
              voucherValidDays: s.voucherValidDays,
              skillId: s.skillId,
              skillUses: s.skillUses,
              skillValidDays: s.skillValidDays,
              daysBefore: s.daysBefore,
              active: s.active,
              pushPlanned: s.pushPlanned,
            }
          : null,
        push:
          s?.pushedAt && s.pushedYear === Number(h.ymd.slice(0, 4))
            ? { pushedAt: s.pushedAt.toISOString(), pushSent: s.pushSent }
            : null,
        gifts: s ? giftsById.get(s.id) ?? 0 : 0,
      };
    });
    const allRows = offers.map((o) => {
      const validFrom = o.validFrom ? dbDateToYmd(o.validFrom) : null;
      const validTo = o.validTo ? dbDateToYmd(o.validTo) : null;
      return {
        id: o.id,
        title: o.title,
        text: o.text,
        validFrom,
        validTo,
        active: o.active,
        visible: offerVisible({ active: o.active, fromYmd: validFrom, toYmd: validTo }, today),
        pushPlanned: o.pushPlanned,
        pushedAt: o.pushedAt?.toISOString() ?? null,
        pushSent: o.pushSent,
        audience: o.audience,
        kind: o.kind,
      } satisfies OfferAdminRow & { kind: string };
    });
    const rows: OfferAdminRow[] = allRows.filter((r) => r.kind === "OFFER");
    // News die neueste zuerst, wie in der App.
    const newsRows: OfferAdminRow[] = allRows.filter((r) => r.kind === "NEWS").reverse();
    // Meldungen in der App: News, Challenges, Angebote und Feiertage in einem Reiter.
    content = (
      <>
        <OffersCard kind="NEWS" offers={newsRows} reach={reach} beachEnabled={config?.beachEnabled ?? false} />
        <ChallengesCard
          challenges={challengeRows}
          today={today}
          reach={reach}
          skills={skillChoices}
          beachEnabled={config?.beachEnabled ?? false}
        />
        <OffersCard offers={rows} reach={reach} beachEnabled={config?.beachEnabled ?? false} />
        <BirthdayCard data={birthday} />
        <HolidaysCard rows={holidayRows} reach={reach} skills={skillChoices} />
      </>
    );
  }

  if (tab === "gutscheine") {
    const vouchers = await db.voucher.findMany({
      where: { accountId, kind: "BENEFIT" },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const ownerIds = [...new Set(vouchers.map((v) => v.ownerTicketId).filter((id): id is number => id != null))];
    const owners = ownerIds.length
      ? await db.ticket.findMany({
          where: { accountId, id: { in: ownerIds } },
          select: { id: true, name: true, firstName: true, lastName: true },
        })
      : [];
    const ownerById = new Map(owners.map((t) => [t.id, ticketLabel(t)]));
    const now = new Date();
    const rows: BenefitVoucherRow[] = vouchers.map((v) => ({
      id: v.id,
      code: v.code,
      label: v.label ?? "Gutschein",
      owner: v.ownerTicketId != null ? ownerById.get(v.ownerTicketId) ?? null : null,
      source: v.notes,
      state: benefitVoucherState(v, now),
      createdAt: v.createdAt.toISOString(),
      expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
      redeemedAt: v.redeemedAt ? v.redeemedAt.toISOString() : null,
      redeemedVia: v.redeemedVia,
    }));
    const since30 = new Date(now.getTime() - 30 * 86_400_000);
    const [skills, skillDevices, openGrants, uses30, useRows, voteConfig] = await Promise.all([
      db.riderSkill.findMany({
        where: { accountId },
        orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
        include: { device: { select: { name: true } } },
      }),
      db.device.findMany({
        where: { accountId, OR: [{ type: "SHELLY", category: { in: ["TASTER", "SCHALTER", "BELEUCHTUNG"] } }, { type: "HUE_LIGHT" }] },
        select: { id: true, name: true, type: true, category: true, pulseSeconds: true },
        orderBy: [{ category: "desc" }, { name: "asc" }],
      }),
      db.riderSkillGrant.findMany({
        where: { accountId, disabledAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        select: { skillId: true, uses: true, usedCount: true },
      }),
      db.riderSkillUse.groupBy({ by: ["skillId"], where: { accountId, ok: true, createdAt: { gte: since30 } }, _count: { _all: true } }),
      db.riderSkillUse.findMany({
        where: { accountId },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true, createdAt: true, ok: true, error: true,
          skill: { select: { name: true } },
          profile: { select: { nickname: true, tickets: { select: { name: true, firstName: true, lastName: true }, take: 1, orderBy: { id: "desc" } } } },
        },
      }),
      db.gamificationConfig.findUnique({ where: { accountId }, select: { musicVoteZoneIds: true, musicVoteOptions: true } }),
    ]);
    const openBySkill = new Map<number, number>();
    for (const g of openGrants) openBySkill.set(g.skillId, (openBySkill.get(g.skillId) ?? 0) + Math.max(0, g.uses - g.usedCount));
    const usesBySkill = new Map(uses30.map((u) => [u.skillId, u._count._all]));
    const skillRows: SkillAdminRow[] = skills.map((k) => ({
      id: k.id,
      name: k.name,
      description: k.description,
      kind: k.kind,
      deviceId: k.deviceId,
      deviceName: k.device?.name ?? null,
      minutes: k.minutes,
      cooldownMinutes: k.cooldownMinutes,
      onlyOperating: k.onlyOperating,
      onlyOnSite: k.onlyOnSite,
      paused: k.paused,
      active: k.active,
      openUses: openBySkill.get(k.id) ?? 0,
      uses30: usesBySkill.get(k.id) ?? 0,
    }));
    const useList: SkillUseRow[] = useRows.map((u) => {
      const t = u.profile?.tickets[0];
      return {
        id: u.id,
        at: u.createdAt.toISOString(),
        skill: u.skill.name,
        who: t ? ticketLabel(t) : u.profile?.nickname ?? "unbekannt",
        ok: u.ok,
        error: u.error,
      };
    });
    content = (
      <>
        <SkillsCard
          skills={skillRows}
          devices={skillDevices.filter(isSkillDevice).map((d) => ({ id: d.id, name: d.name, category: d.category, pulseSeconds: d.pulseSeconds }))}
          uses={useList}
          musicReady={(voteConfig?.musicVoteZoneIds.length ?? 0) > 0 && (voteConfig?.musicVoteOptions.length ?? 0) > 0}
        />
        <BenefitVouchersCard vouchers={rows} />
      </>
    );
  }

  if (tab === "einstellungen") {
    const [subscriptions, services, devices, sensors, invites, audioZones, playlists, streams, voteStanding] = await Promise.all([
      db.subscription.findMany({ where: { accountId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      db.service.findMany({ where: { accountId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      db.device.findMany({
        where: { accountId, type: "RASPBERRY_PI" },
        select: { id: true, name: true, countsAsStart: true },
        orderBy: { name: "asc" },
      }),
      db.device.findMany({
        where: { accountId, category: "SENSOR" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      inviteStatus(accountId),
      db.audioZone.findMany({ where: { accountId }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
      db.audioPlaylist.findMany({ where: { accountId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      db.audioStream.findMany({ where: { accountId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      loadMusicVoteAdmin(accountId),
    ]);
    const entranceIds = await beachEntranceIds(accountId).catch(() => [] as number[]);
    const beachEntrances = entranceIds.length
      ? (await db.device.findMany({ where: { accountId, id: { in: entranceIds } }, select: { name: true }, orderBy: { name: "asc" } })).map((d) => d.name)
      : [];
    const beachCapacity =
      (await db.accessArea.findMany({ where: { accountId }, select: { name: true, personLimit: true } }))
        .find((a) => /strandbad/i.test(a.name))?.personLimit ?? null;
    content = (
      <>
      <GamiSettingsCard
        initial={{
          enabled: config?.enabled ?? false,
          subscriptionIds: config?.subscriptionIds ?? [],
          startCapPerDay: config?.startCapPerDay ?? 10,
          startDeviceIds: devices.filter((d) => d.countsAsStart).map((d) => d.id),
          dayServiceIds: config?.dayServiceIds ?? [],
          servicePrices: Object.fromEntries([...parsePriceMap(config?.servicePrices)].map(([id, c]) => [String(id), c])),
          subscriptionPrices: Object.fromEntries([...parsePriceMap(config?.subscriptionPrices)].map(([id, c]) => [String(id), c])),
          waterSensorDeviceId: config?.waterSensorDeviceId ?? null,
        }}
        subscriptions={subscriptions}
        services={services}
        devices={devices.map((d) => ({ id: d.id, name: d.name }))}
        sensors={sensors}
        year={year}
      />
      <BeachPassCard
        initial={{ enabled: config?.beachEnabled ?? false, subscriptionIds: config?.beachSubscriptionIds ?? [] }}
        subscriptions={subscriptions}
        rideSubscriptionIds={config?.subscriptionIds ?? []}
        entrances={beachEntrances}
      />
      <OccupancySettingsCard
        initial={normalizeThresholds(
          config ? { mediumFrom: config.occupancyMediumFrom, highFrom: config.occupancyHighFrom } : null,
        )}
      />
      <BeachSettingsCard
        initial={normalizeBeachSettings(
          config ? { factor: config.beachGuestFactor, mediumFrom: config.beachMediumFrom, highFrom: config.beachHighFrom } : null,
        )}
        capacity={beachCapacity}
      />
      <MusicVoteCard
        initial={{
          enabled: config?.musicVoteEnabled ?? false,
          zoneIds: config?.musicVoteZoneIds ?? [],
          options: config?.musicVoteOptions ?? [],
          holdMinutes: config?.musicVoteHoldMinutes ?? 60,
          roundMinutes: config?.musicVoteRoundMinutes ?? 15,
        }}
        zones={audioZones}
        playlists={playlists}
        streams={streams}
        standing={voteStanding}
      />
      <AppInviteCard initial={invites} />
      <AppShareCard
        accountName={session.user.accountName ?? ""}
        rankingPath={config?.displayToken ? `/rangliste/${config.displayToken}` : null}
        beach={config?.beachEnabled ?? false}
      />
      </>
    );
  }

  return (
    <>
      <Header title="Kunden App" accountName={session.user.accountName} />
      <div className="page-content space-y-4 sm:space-y-5">
        {tabs}
        {!config?.enabled && tab !== "einstellungen" && (
          <Notice tone="info" compact title="Die Gamification ist noch aus. Unter Einstellungen wählst du Abos und Start-Geräte und schaltest sie ein." />
        )}
        {content}
      </div>
    </>
  );
}
