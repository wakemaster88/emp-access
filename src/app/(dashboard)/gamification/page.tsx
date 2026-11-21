import { redirect } from "next/navigation";
import { Award, BarChart3, CalendarCheck, Gift, Megaphone, Play, Settings, Trophy, Users } from "lucide-react";
import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { isTenantAdminRole } from "@/lib/api-auth";
import { berlinYmd } from "@/lib/berlin-day";
import {
  benefitVoucherState, challengePhase, dbDateToYmd, offerVisible, parsePriceMap, ymdToDbDate,
  type GamiMetric, type GamiPeriod, type GamiTier,
} from "@/lib/gamification";
import { challengeUnits, settleDueChallenges, type ChallengeRow } from "@/lib/challenge-service";
import { Header } from "@/components/layout/header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { MilestonesCard, type MilestoneRow } from "@/components/gamification/milestones-card";
import { loadOpeningDays, loadWaterNow } from "@/lib/gamification-service";
import { BenefitVouchersCard, type BenefitVoucherRow } from "@/components/gamification/benefit-vouchers-card";
import { RidersCard, type RiderRow } from "@/components/gamification/riders-card";
import { DayGuestMailsCard, type DayGuestMailRow } from "@/components/gamification/day-guest-mails-card";
import { ChallengesCard, type ChallengeAdminRow } from "@/components/gamification/challenges-card";
import { OffersCard, type OfferAdminRow } from "@/components/gamification/offers-card";
import { riderPushReach } from "@/lib/rider-announce";
import { GamiSettingsCard } from "@/components/gamification/gami-settings-card";
import { AppShareCard } from "@/components/gamification/app-share-card";
import { OccupancySettingsCard } from "@/components/gamification/occupancy-settings-card";
import { BeachSettingsCard } from "@/components/gamification/beach-settings-card";
import { normalizeBeachSettings } from "@/lib/beach-occupancy";
import { normalizeThresholds } from "@/lib/rider-occupancy";
import { AppInviteCard } from "@/components/gamification/app-invite-card";
import { inviteStatus } from "@/lib/rider-invite";

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

  if (tab === "auswertung") {
    const [perTicket, awards, openVouchers, redeemedVouchers] = await Promise.all([
      db.riderDayStat.groupBy({
        by: ["ticketId"],
        where: { accountId, day: yearRange },
        _count: { _all: true },
        _sum: { starts: true },
      }),
      // Nach dem Tag der Vergabe: Awards ohne Zeitraum tragen kein Jahr im Schlüssel.
      db.milestoneAward.count({
        where: { accountId, awardedAt: { gte: new Date(`${year}-01-01T00:00:00+01:00`), lt: new Date(`${year + 1}-01-01T00:00:00+01:00`) } },
      }),
      db.voucher.count({
        where: {
          accountId, kind: "BENEFIT", redeemedAt: null, disabledAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        },
      }),
      db.voucher.count({ where: { accountId, kind: "BENEFIT", redeemedAt: { not: null } } }),
    ]);

    const riders = perTicket
      .map((r) => ({ ticketId: r.ticketId, visitDays: r._count._all, starts: r._sum.starts ?? 0 }))
      .sort((a, b) => b.visitDays - a.visitDays || b.starts - a.starts);
    const totalDays = riders.reduce((s, r) => s + r.visitDays, 0);
    const totalStarts = riders.reduce((s, r) => s + r.starts, 0);
    const buckets = [
      { label: "1 bis 4 Besuchstage", count: riders.filter((r) => r.visitDays <= 4).length },
      { label: "5 bis 9 Besuchstage", count: riders.filter((r) => r.visitDays >= 5 && r.visitDays <= 9).length },
      { label: "10 bis 19 Besuchstage", count: riders.filter((r) => r.visitDays >= 10 && r.visitDays <= 19).length },
      { label: "20 und mehr Besuchstage", count: riders.filter((r) => r.visitDays >= 20).length },
    ];
    const top = riders.slice(0, 10);
    const tickets = top.length
      ? await db.ticket.findMany({
          where: { accountId, id: { in: top.map((r) => r.ticketId) } },
          select: { id: true, name: true, firstName: true, lastName: true },
        })
      : [];
    const nameById = new Map(tickets.map((t) => [t.id, ticketLabel(t)]));

    content = (
      <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Aktive Fahrer" value={riders.length} icon={Users} hint={`Saison ${year}`} />
          <StatCard label="Besuchstage" value={totalDays} icon={CalendarCheck} tone="info" hint="alle Fahrer zusammen" />
          <StatCard label="Starts" value={totalStarts} icon={Play} tone="success" hint="an den Start-Geräten" />
          <StatCard label="Awards vergeben" value={awards} icon={Trophy} tone="violet" hint={`${openVouchers} Gutscheine offen, ${redeemedVouchers} eingelöst`} />
        </div>
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
          <Card flush>
            <CardHeader>
              <CardTitle>Wie oft die Fahrer kommen</CardTitle>
              <CardDescription>Fahrer nach Besuchstagen in der Saison {year}.</CardDescription>
            </CardHeader>
            <Table edge>
              <TableBody>
                {buckets.map((b) => (
                  <TableRow key={b.label}>
                    <TableCell>{b.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Card flush>
            <CardHeader>
              <CardTitle>Meiste Besuchstage</CardTitle>
              <CardDescription>Nur hier in der Verwaltung sichtbar.</CardDescription>
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
                  <TableRow key={r.ticketId}>
                    <TableCell className="max-sm:whitespace-normal">{nameById.get(r.ticketId) ?? `Ticket ${r.ticketId}`}</TableCell>
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
      active: m.active,
      awarded: awarded.get(m.id) ?? 0,
      redeemed: redeemed.get(m.id) ?? 0,
    }));
    content = (
      <MilestonesCard
        milestones={rows}
        today={berlinYmd(new Date())}
        openingDay={openingDays[String(year)] ?? null}
        waterSensor={sensor ? { name: sensor.name, now: waterNow } : null}
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
    const challengeRows: ChallengeAdminRow[] = [];
    for (const c of challenges) {
      const startDate = dbDateToYmd(c.startDate);
      const endDate = dbDateToYmd(c.endDate);
      const phase = challengePhase({ startYmd: startDate, endYmd: endDate }, today);
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
        voucherLabel: c.voucherLabel,
        voucherValidDays: c.voucherValidDays,
        active: c.active,
        settled: c.settledAt != null,
        phase,
        participants: units.filter((u) => u.value > 0).length,
        winners: winnersById.get(c.id) ?? 0,
        pushPlanned: c.pushPlanned,
        pushedAt: c.pushedAt?.toISOString() ?? null,
        pushSent: c.pushSent,
      });
    }
    const [offers, reach] = await Promise.all([
      db.riderOffer.findMany({
        where: { accountId },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        take: 200,
      }),
      riderPushReach(accountId),
    ]);
    const rows: OfferAdminRow[] = offers.map((o) => {
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
      };
    });
    // Beides sind Meldungen in der App mit optionalem Push: ein Reiter, zwei Listen.
    content = (
      <>
        <ChallengesCard challenges={challengeRows} today={today} reach={reach} />
        <OffersCard offers={rows} reach={reach} />
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
    content = <BenefitVouchersCard vouchers={rows} />;
  }

  if (tab === "einstellungen") {
    const [subscriptions, services, devices, sensors, invites] = await Promise.all([
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
    ]);
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
      <AppInviteCard initial={invites} />
      <AppShareCard
        accountName={session.user.accountName ?? ""}
        rankingPath={config?.displayToken ? `/rangliste/${config.displayToken}` : null}
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
