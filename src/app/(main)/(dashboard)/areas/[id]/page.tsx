import Link from "next/link";
import { PartyPopper } from "lucide-react";
import { safeAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { tenantClient } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { AreaDetailView, type AreaDetailData } from "@/components/areas/area-detail-view";
import { loadAreaEditorData } from "@/lib/area-editor-data";
import { addCalendarDays, berlinDayRange, berlinYmd } from "@/lib/berlin-day";
import { summarizeTurnstileDay } from "@/lib/turnstile-stats";
import { summarizeAreaRates } from "@/lib/turnstile-rate";
import { scanDenyReasonLabel } from "@/lib/scan-deny-reason";

interface Props {
  params: Promise<{ id: string }>;
}

/** Pi-Heartbeat der letzten 5 Minuten = online (wie Dashboard und Gerätedetails). */
const ONLINE_WINDOW_MS = 5 * 60_000;
const RECENT_SCANS = 25;

/**
 * Detailseite einer Ressource: Lagebild des Tages (Belegung, Ein- und
 * Auslässe, Ablehnungen), Geräte mit Zustand, letzte Scans, Regeln, Zugang
 * über Services/Abos/anny, Tickets und Hierarchie. Bearbeitet wird über den
 * bekannten Dialog (eine Ebene, docs/design-regeln.md, Abschnitt 18).
 */
export default async function AreaDetailPage({ params }: Props) {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/areas");

  const { id } = await params;
  const areaId = Number(id);
  if (!Number.isInteger(areaId)) notFound();

  const accountId = session.user.accountId;
  const db = tenantClient(accountId);
  const accountFilter = { accountId };

  const area = await db.accessArea.findFirst({
    where: { id: areaId, accountId },
    include: {
      parent: { select: { id: true, name: true } },
      children: {
        select: { id: true, name: true, _count: { select: { tickets: true } } },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!area) notFound();

  const now = new Date();
  const dateStr = berlinYmd(now);
  const { start: dayStart, endExclusive } = berlinDayRange(dateStr);
  const weekStart = berlinDayRange(addCalendarDays(dateStr, -6)).start;

  const [allAreas, editor] = await Promise.all([
    db.accessArea.findMany({ where: accountFilter, orderBy: { name: "asc" } }),
    loadAreaEditorData(db, accountFilter),
  ]);

  const areaDevices = editor.devices.filter((d) => d.accessIn === areaId || d.accessOut === areaId);
  const deviceIds = areaDevices.map((d) => d.id);
  const ticketScope = { OR: [{ accessAreaId: areaId }, { ticketAreas: { some: { accessAreaId: areaId } } }] };

  const [
    dayScans, weekScans, recentScans, soldTickets, ticketStatus, validNow,
    services, subscriptions, annyLinks,
  ] = await Promise.all([
    deviceIds.length
      ? db.scan.findMany({
          where: { accountId, deviceId: { in: deviceIds }, scanTime: { gte: dayStart, lt: endExclusive } },
          select: {
            result: true, note: true, scanTime: true, deviceId: true, ticketId: true,
            ticket: {
              select: {
                ticketTypeName: true,
                service: { select: { name: true } },
                subscription: { select: { name: true } },
              },
            },
          },
          orderBy: { scanTime: "asc" },
        })
      : Promise.resolve([]),
    deviceIds.length
      ? db.scan.findMany({
          where: { accountId, deviceId: { in: deviceIds }, scanTime: { gte: weekStart, lt: endExclusive } },
          select: { result: true, scanTime: true, ticketId: true },
        })
      : Promise.resolve([]),
    deviceIds.length
      ? db.scan.findMany({
          where: { accountId, deviceId: { in: deviceIds } },
          select: {
            id: true, result: true, note: true, scanTime: true, code: true,
            device: { select: { id: true, name: true } },
            ticket: {
              select: {
                id: true, name: true, firstName: true, lastName: true, ticketTypeName: true,
                service: { select: { name: true } },
                subscription: { select: { name: true } },
              },
            },
          },
          orderBy: { scanTime: "desc" },
          take: RECENT_SCANS,
        })
      : Promise.resolve([]),
    db.ticket.count({
      where: {
        accountId,
        createdAt: { gte: dayStart, lt: endExclusive },
        OR: [{ accessAreaId: areaId }, { service: { mainAccessAreaId: areaId } }],
      },
    }),
    db.ticket.groupBy({
      by: ["status"],
      where: { accountId, accessAreaId: areaId },
      _count: true,
    }),
    // Wie die Löschsperre in api/areas/[id]: noch gültig, direkt oder über Mehrbereichs-Tickets.
    db.ticket.count({
      where: {
        accountId,
        status: { in: ["VALID", "REDEEMED", "PAUSED"] },
        AND: [ticketScope, { OR: [{ endDate: null }, { endDate: { gte: now } }] }],
      },
    }),
    db.serviceArea.findMany({
      where: { accessAreaId: areaId, service: { accountId } },
      select: {
        service: { select: { id: true, name: true, mainAccessAreaId: true, allowReentry: true } },
      },
      orderBy: { service: { name: "asc" } },
    }),
    db.subscription.findMany({
      where: { accountId, areas: { some: { id: areaId } } },
      select: { id: true, name: true, _count: { select: { tickets: true } } },
      orderBy: { name: "asc" },
    }),
    db.annyResourceLink.findMany({
      where: { accountId, accessAreaId: areaId },
      select: { annyName: true },
      orderBy: { annyName: "asc" },
    }).catch(() => [] as { annyName: string }[]),
  ]);

  const summary = summarizeTurnstileDay({
    dateStr,
    dayScans: dayScans.map((s) => ({
      result: s.result,
      note: s.note,
      scanTime: s.scanTime,
      deviceId: s.deviceId,
      ticketId: s.ticketId,
      ticketTypeName: s.ticket?.ticketTypeName || s.ticket?.service?.name || s.ticket?.subscription?.name || null,
    })),
    weekScans,
    soldTickets,
    deviceIds,
  });

  const [rate] = summarizeAreaRates(
    [{ id: area.id, name: area.name, personLimit: area.personLimit }],
    areaDevices,
    dayScans,
    now,
    dayStart,
  );

  const onlineSince = now.getTime() - ONLINE_WINDOW_MS;

  const data: AreaDetailData = {
    area: {
      id: area.id,
      name: area.name,
      parentId: area.parentId,
      allowReentry: area.allowReentry,
      personLimit: area.personLimit,
      scanLockSeconds: area.scanLockSeconds,
      showOnDashboard: area.showOnDashboard,
      openingHours: area.openingHours,
    },
    parent: area.parent,
    children: area.children.map((c) => ({ id: c.id, name: c.name, ticketCount: c._count.tickets })),
    rate: rate
      ? {
          inToday: rate.inToday, in60: rate.in60, in15: rate.in15,
          outToday: rate.outToday, out60: rate.out60,
          inside: rate.inside,
        }
      : null,
    totals: {
      scans: summary.totals.scans,
      granted: summary.totals.rides,
      denied: summary.totals.denied,
      guests: summary.totals.guests,
      soldTickets: summary.totals.soldTickets,
      firstScanAt: summary.totals.firstScanAt?.toISOString() ?? null,
      lastScanAt: summary.totals.lastScanAt?.toISOString() ?? null,
      peakHour: summary.totals.peakHour,
    },
    average: summary.average,
    hourly: summary.hourly,
    weekTrend: summary.weekTrend,
    ticketTypes: summary.ticketTypes,
    denyReasons: summary.denyReasons,
    devices: areaDevices.map((d) => {
      const stats = summary.deviceStats.get(d.id);
      const direction = d.accessIn === areaId && d.accessOut === areaId ? "BOTH" : d.accessIn === areaId ? "IN" : "OUT";
      // Online-Zustand gibt es nur über den Pi-Heartbeat; andere Geräte zeigen keinen.
      const online = d.type === "RASPBERRY_PI" ? !!d.lastUpdate && d.lastUpdate.getTime() >= onlineSince : null;
      return {
        id: d.id,
        name: d.name,
        type: d.type,
        category: d.category,
        direction,
        isActive: d.isActive,
        online,
        lastUpdate: d.lastUpdate?.toISOString() ?? null,
        granted: stats?.granted ?? 0,
        denied: stats?.denied ?? 0,
        lastScanAt: stats?.lastScanAt ? stats.lastScanAt.toISOString() : null,
      };
    }),
    recentScans: recentScans.map((s) => {
      const t = s.ticket;
      const person = t ? [t.firstName, t.lastName].filter(Boolean).join(" ") : "";
      return {
        id: s.id,
        result: s.result,
        at: s.scanTime.toISOString(),
        device: s.device ? { id: s.device.id, name: s.device.name } : null,
        ticket: t ? (person || t.name) : null,
        ticketType: t ? (t.ticketTypeName || t.service?.name || t.subscription?.name || null) : null,
        reason: s.result === "GRANTED" ? null : scanDenyReasonLabel(s.note),
      };
    }),
    tickets: {
      validNow,
      byStatus: Object.fromEntries(ticketStatus.map((g) => [g.status, g._count])),
    },
    services: services.map(({ service }) => ({
      id: service.id,
      name: service.name,
      isMain: service.mainAccessAreaId === areaId,
    })),
    subscriptions: subscriptions.map((s) => ({ id: s.id, name: s.name, ticketCount: s._count.tickets })),
    annyLinks: annyLinks.map((l) => l.annyName),
    renderedAt: now.toISOString(),
  };

  return (
    <>
      <Header title="Ressourcen" accountName={session.user.accountName} />
      <div className="page-content space-y-4">
        {area.eventVenue && (
          <Notice
            tone="info"
            icon={PartyPopper}
            title="Veranstaltungsraum"
            action={<Button asChild variant="outline" size="sm"><Link href={`/veranstaltungen`}>Belegung</Link></Button>}
            compact
          >
            Termine, Partner, Zusatzleistungen und Rechnungen stehen unter Veranstaltungen.
          </Notice>
        )}
        <AreaDetailView
          data={data}
          allAreas={allAreas.map((a) => ({
            id: a.id,
            name: a.name,
            parentId: a.parentId,
            allowReentry: a.allowReentry,
            personLimit: a.personLimit,
            scanLockSeconds: a.scanLockSeconds,
            showOnDashboard: a.showOnDashboard,
            openingHours: a.openingHours,
          }))}
          editorDevices={editor.accessDevices}
          annyResources={editor.annyResources}
          annyServices={editor.annyServices}
          annyMappings={editor.annyMappings}
        />
      </div>
    </>
  );
}
