import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

/**
 * Diagnose für eine Email-Regel: zeigt, warum sie ggf. nichts versendet.
 * Liefert pro Stufe Zähler (Funnel) sowie eine Sample-Liste der nächsten
 * passenden Tickets, damit man sofort sieht, ob das Trigger-Fenster zu eng,
 * `Ticket.email` noch leer, oder schlicht kein Bestand vorhanden ist.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const rule = await db.emailRule.findFirst({ where: { id, accountId: accountId! } });
  if (!rule) {
    return NextResponse.json({ error: "Regel nicht gefunden" }, { status: 404 });
  }

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + MS_PER_DAY);

  const offset = rule.daysOffset;
  const lookback = Math.max(0, rule.lookbackDays ?? 0);

  type DateRange = { gte: Date; lt: Date };
  let triggerWindow: DateRange;
  let triggerField: "endDate" | "firstScanAt" | "createdAt";
  switch (rule.trigger) {
    case "SUBSCRIPTION_EXPIRING":
      triggerWindow = {
        gte: new Date(today.getTime() + (offset - lookback) * MS_PER_DAY),
        lt: new Date(tomorrow.getTime() + offset * MS_PER_DAY),
      };
      triggerField = "endDate";
      break;
    case "SUBSCRIPTION_EXPIRED":
      triggerWindow = {
        gte: new Date(today.getTime() + (-offset - lookback) * MS_PER_DAY),
        lt: new Date(tomorrow.getTime() + -offset * MS_PER_DAY),
      };
      triggerField = "endDate";
      break;
    case "DAY_VISIT_FOLLOWUP":
      triggerWindow = {
        gte: new Date(today.getTime() + (-offset - lookback) * MS_PER_DAY),
        lt: new Date(tomorrow.getTime() + -offset * MS_PER_DAY),
      };
      triggerField = "firstScanAt";
      break;
    case "TICKET_WELCOME":
      triggerWindow = {
        gte: new Date(today.getTime() + (-offset - lookback) * MS_PER_DAY),
        lt: new Date(tomorrow.getTime() + -offset * MS_PER_DAY),
      };
      triggerField = "createdAt";
      break;
  }

  const subscriptionFilter = rule.subscriptionId
    ? { subscriptionId: rule.subscriptionId }
    : rule.trigger === "SUBSCRIPTION_EXPIRING" || rule.trigger === "SUBSCRIPTION_EXPIRED"
      ? { subscriptionId: { not: null } }
      : rule.trigger === "DAY_VISIT_FOLLOWUP"
        ? { subscriptionId: null }
        : {};
  const serviceFilter = rule.serviceId ? { serviceId: rule.serviceId } : {};

  // Funnel-Zähler: schrittweise hinzukommende Filter zeigen, wo's hakt.
  const [
    ticketsTotal,
    ticketsWithEmail,
    ticketsValidStatus,
    ticketsWithTriggerField,
    ticketsScopeMatch,
    ticketsInWindow,
  ] = await Promise.all([
    db.ticket.count({ where: { accountId: accountId! } }),
    db.ticket.count({ where: { accountId: accountId!, email: { not: null } } }),
    db.ticket.count({
      where: {
        accountId: accountId!,
        email: { not: null },
        status: { in: ["VALID", "REDEEMED"] },
      },
    }),
    db.ticket.count({
      where: {
        accountId: accountId!,
        email: { not: null },
        status: { in: ["VALID", "REDEEMED"] },
        [triggerField]: { not: null },
      },
    }),
    db.ticket.count({
      where: {
        accountId: accountId!,
        email: { not: null },
        status: { in: ["VALID", "REDEEMED"] },
        [triggerField]: { not: null },
        ...subscriptionFilter,
        ...serviceFilter,
      },
    }),
    db.ticket.count({
      where: {
        accountId: accountId!,
        email: { not: null },
        status: { in: ["VALID", "REDEEMED"] },
        [triggerField]: triggerWindow,
        ...subscriptionFilter,
        ...serviceFilter,
      },
    }),
  ]);

  const cooldownStart = new Date(now.getTime() - rule.cooldownDays * MS_PER_DAY);
  const ticketsInWindowList = await db.ticket.findMany({
    where: {
      accountId: accountId!,
      email: { not: null },
      status: { in: ["VALID", "REDEEMED"] },
      [triggerField]: triggerWindow,
      ...subscriptionFilter,
      ...serviceFilter,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      ticketTypeName: true,
      endDate: true,
      firstScanAt: true,
      createdAt: true,
    },
    take: 20,
    orderBy: { [triggerField]: "asc" },
  });

  const cooldownHitIds = new Set<number>();
  if (ticketsInWindowList.length > 0) {
    const hits = await db.emailSend.findMany({
      where: {
        accountId: accountId!,
        ruleId: rule.id,
        status: "SENT",
        sentAt: { gte: cooldownStart },
        ticketId: { in: ticketsInWindowList.map((t) => t.id) },
      },
      select: { ticketId: true },
    });
    for (const h of hits) if (h.ticketId != null) cooldownHitIds.add(h.ticketId);
  }

  const ticketsAfterCooldown = ticketsInWindow - cooldownHitIds.size;

  // Vorschau: nächste Tickets außerhalb des Fensters, damit man sieht, wann
  // die Regel das nächste Mal greifen würde.
  const upcomingSample = await db.ticket.findMany({
    where: {
      accountId: accountId!,
      email: { not: null },
      status: { in: ["VALID", "REDEEMED"] },
      [triggerField]: { gte: triggerWindow.lt },
      ...subscriptionFilter,
      ...serviceFilter,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      endDate: true,
      firstScanAt: true,
      createdAt: true,
    },
    take: 5,
    orderBy: { [triggerField]: "asc" },
  });

  const lastSend = await db.emailSend.findFirst({
    where: { accountId: accountId!, ruleId: rule.id },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true, status: true, to: true, errorMessage: true },
  });

  return NextResponse.json({
    rule: {
      id: rule.id,
      name: rule.name,
      trigger: rule.trigger,
      daysOffset: rule.daysOffset,
      lookbackDays: rule.lookbackDays,
      cooldownDays: rule.cooldownDays,
      isActive: rule.isActive,
      subscriptionId: rule.subscriptionId,
      serviceId: rule.serviceId,
    },
    now: now.toISOString(),
    triggerField,
    triggerWindow: {
      from: triggerWindow.gte.toISOString(),
      to: triggerWindow.lt.toISOString(),
    },
    funnel: {
      ticketsTotal,
      ticketsWithEmail,
      ticketsValidStatus,
      ticketsWithTriggerField,
      ticketsScopeMatch,
      ticketsInWindow,
      cooldownBlocked: cooldownHitIds.size,
      ticketsWouldSend: Math.max(0, ticketsAfterCooldown),
    },
    samplesInWindow: ticketsInWindowList.map((t) => ({
      id: t.id,
      name: [t.firstName, t.lastName].filter(Boolean).join(" ") || null,
      email: t.email,
      ticketTypeName: t.ticketTypeName,
      triggerDate:
        triggerField === "endDate"
          ? t.endDate?.toISOString() ?? null
          : triggerField === "firstScanAt"
            ? t.firstScanAt?.toISOString() ?? null
            : t.createdAt.toISOString(),
      cooldownBlocked: cooldownHitIds.has(t.id),
    })),
    upcomingSample: upcomingSample.map((t) => ({
      id: t.id,
      name: [t.firstName, t.lastName].filter(Boolean).join(" ") || null,
      email: t.email,
      triggerDate:
        triggerField === "endDate"
          ? t.endDate?.toISOString() ?? null
          : triggerField === "firstScanAt"
            ? t.firstScanAt?.toISOString() ?? null
            : t.createdAt.toISOString(),
    })),
    lastSend,
  });
}
