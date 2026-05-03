/**
 * Email-Automation-Engine: laedt aktive Regeln eines Accounts, findet
 * passende Tickets und versendet die Mails idempotent ueber den Email-Sender.
 *
 * Wird vom Cron-Job /api/cron/email-automations und vom Test-Endpoint
 * verwendet. Die Auswertung ist absichtlich konservativ: pro Lauf werden
 * nur Tickets in einem 24h-Fenster um die Trigger-Tage betrachtet, damit
 * Cron-Reruns am gleichen Tag keine Doppel-Sends verursachen (zusätzlich
 * abgesichert durch `EmailSend`-Cooldown).
 */

import { prisma } from "@/lib/prisma";
import { sendEmail, type EmailProvider } from "@/lib/email-sender";
import {
  renderTemplate,
  wrapEmailHtml,
  type TemplateVariables,
} from "@/lib/email-templates";
import { randomBytes } from "crypto";
import type { EmailRule, EmailRuleTrigger, Ticket } from "@prisma/client";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

function fmtDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function diffDaysAbs(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / MS_PER_DAY);
}

interface TicketCandidate {
  ticket: Ticket & {
    subscription?: { id: number; name: string } | null;
    service?: { id: number; name: string } | null;
  };
  /** Bezugs-Datum, das die Mail auslöst (z. B. endDate oder firstScanAt). */
  triggerDate: Date;
  /** Tage relativ zur Auslösung (positiv = in der Vergangenheit, negativ = Zukunft). */
  daysSinceTrigger: number;
}

/** Lädt Kandidaten für eine Regel im Fenster [startOfDay(now)+0; +1). */
async function loadCandidates(
  accountId: number,
  rule: EmailRule,
  now: Date,
): Promise<TicketCandidate[]> {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);

  // Wir suchen alle Tickets mit Email, deren Trigger-Datum heute innerhalb
  // des Offsets liegt:
  //   trigger == SUBSCRIPTION_EXPIRING  → endDate ∈ [today + offset, today + offset + 1)
  //   trigger == SUBSCRIPTION_EXPIRED   → endDate ∈ [today - offset - 1, today - offset)
  //   trigger == DAY_VISIT_FOLLOWUP     → firstScanAt ∈ [today - offset - 1, today - offset)
  //   trigger == TICKET_WELCOME         → createdAt ∈ [today - offset - 1, today - offset)
  const offset = rule.daysOffset;

  const baseWhere = {
    accountId,
    email: { not: null },
    status: { in: ["VALID" as const, "REDEEMED" as const] },
    ...(rule.subscriptionId ? { subscriptionId: rule.subscriptionId } : {}),
    ...(rule.serviceId ? { serviceId: rule.serviceId } : {}),
  };

  let where: Record<string, unknown> = baseWhere;
  let triggerField: "endDate" | "firstScanAt" | "createdAt" = "endDate";

  switch (rule.trigger as EmailRuleTrigger) {
    case "SUBSCRIPTION_EXPIRING": {
      // Nur echte Abos
      where = {
        ...baseWhere,
        subscriptionId: rule.subscriptionId ?? { not: null },
        endDate: {
          gte: addDays(today, offset),
          lt: addDays(tomorrow, offset),
        },
      };
      triggerField = "endDate";
      break;
    }
    case "SUBSCRIPTION_EXPIRED": {
      where = {
        ...baseWhere,
        subscriptionId: rule.subscriptionId ?? { not: null },
        endDate: {
          gte: addDays(today, -offset - 1),
          lt: addDays(today, -offset),
        },
      };
      triggerField = "endDate";
      break;
    }
    case "DAY_VISIT_FOLLOWUP": {
      where = {
        ...baseWhere,
        // Kein Abo-Ticket – Followup nur für Tagesgäste/Service.
        subscriptionId: null,
        firstScanAt: {
          gte: addDays(today, -offset - 1),
          lt: addDays(today, -offset),
        },
      };
      triggerField = "firstScanAt";
      break;
    }
    case "TICKET_WELCOME": {
      where = {
        ...baseWhere,
        createdAt: {
          gte: addDays(today, -offset - 1),
          lt: addDays(today, -offset),
        },
      };
      triggerField = "createdAt";
      break;
    }
  }

  const tickets = await prisma.ticket.findMany({
    where,
    include: {
      subscription: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
    },
    take: 500,
  });

  const result: TicketCandidate[] = [];
  for (const t of tickets) {
    const triggerDate =
      triggerField === "endDate"
        ? t.endDate
        : triggerField === "firstScanAt"
          ? t.firstScanAt
          : t.createdAt;
    if (!triggerDate) continue;
    result.push({
      ticket: t,
      triggerDate,
      daysSinceTrigger: Math.round((today.getTime() - startOfDay(triggerDate).getTime()) / MS_PER_DAY),
    });
  }
  return result;
}

async function isWithinCooldown(args: {
  accountId: number;
  ruleId: number;
  ticketId: number;
  cooldownDays: number;
  now: Date;
}): Promise<boolean> {
  const cooldownStart = addDays(args.now, -args.cooldownDays);
  const last = await prisma.emailSend.findFirst({
    where: {
      accountId: args.accountId,
      ruleId: args.ruleId,
      ticketId: args.ticketId,
      status: "SENT",
      sentAt: { gte: cooldownStart },
    },
    select: { id: true },
  });
  return last != null;
}

interface RuleRunStats {
  ruleId: number;
  name: string;
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: { ticketId: number; error: string }[];
}

interface AccountRunResult {
  accountId: number;
  ok: boolean;
  ruleStats: RuleRunStats[];
  totalSent: number;
  error?: string;
}

function buildVoucherCode(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function buildTemplateVars(args: {
  candidate: TicketCandidate;
  accountName: string;
  rule: EmailRule;
  voucher?: { code: string; expiresAt: Date | null; discountPercent: number | null } | null;
  brand?: { color: string | null; logo: string | null; website: string | null };
}): TemplateVariables {
  const { candidate, accountName, rule, voucher, brand } = args;
  const t = candidate.ticket;
  const fullName = [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name;
  const daysUntilExpiry = candidate.triggerDate
    ? Math.round((startOfDay(candidate.triggerDate).getTime() - startOfDay(new Date()).getTime()) / MS_PER_DAY)
    : null;
  return {
    firstName: t.firstName ?? fullName.split(" ")[0] ?? "",
    lastName: t.lastName ?? "",
    fullName,
    ticketTypeName: t.ticketTypeName,
    subscriptionName: t.subscription?.name ?? null,
    serviceName: t.service?.name ?? null,
    accountName,
    endDate: fmtDate(t.endDate),
    startDate: fmtDate(t.startDate),
    daysUntilExpiry: daysUntilExpiry != null ? String(Math.max(0, daysUntilExpiry)) : null,
    daysSinceVisit: String(diffDaysAbs(new Date(), candidate.triggerDate)),
    voucherCode: voucher?.code ?? null,
    voucherExpiresAt: voucher?.expiresAt ? fmtDate(voucher.expiresAt) : null,
    voucherDiscountPercent: voucher?.discountPercent != null ? String(voucher.discountPercent) : null,
    voucherUrl: voucher?.code ? `https://emp-access/voucher/${voucher.code}` : null,
    renewUrl: rule.renewUrl ?? null,
    websiteUrl: brand?.website ?? null,
    brandColor: brand?.color ?? null,
    logoUrl: brand?.logo ?? null,
  };
}

/**
 * Verarbeitet alle aktiven Regeln eines Accounts. Für Cron + Manual-Trigger.
 * Voraussetzung: Account hat eine aktive `EmailConfig` mit gültigem Provider.
 */
export async function processAccountEmailRules(
  accountId: number,
  options?: { now?: Date; ruleIds?: number[] },
): Promise<AccountRunResult> {
  const now = options?.now ?? new Date();

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { name: true },
  });
  if (!account) {
    return { accountId, ok: false, ruleStats: [], totalSent: 0, error: "Account nicht gefunden" };
  }

  const config = await prisma.emailConfig.findUnique({ where: { accountId } });
  if (!config || !config.isActive) {
    return { accountId, ok: false, ruleStats: [], totalSent: 0, error: "Email-Versand inaktiv" };
  }
  if (!config.apiKey || !config.fromEmail) {
    return {
      accountId,
      ok: false,
      ruleStats: [],
      totalSent: 0,
      error: "Email-Konfiguration unvollstaendig (apiKey/fromEmail)",
    };
  }

  const provider: EmailProvider = {
    provider: config.provider,
    apiKey: config.apiKey,
    fromEmail: config.fromEmail,
    fromName: config.fromName,
    replyTo: config.replyTo,
  };

  const rules = await prisma.emailRule.findMany({
    where: {
      accountId,
      isActive: true,
      ...(options?.ruleIds ? { id: { in: options.ruleIds } } : {}),
    },
  });

  const ruleStats: RuleRunStats[] = [];
  let totalSent = 0;

  for (const rule of rules) {
    const stats: RuleRunStats = {
      ruleId: rule.id,
      name: rule.name,
      considered: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    try {
      const candidates = await loadCandidates(accountId, rule, now);
      stats.considered = candidates.length;

      for (const candidate of candidates) {
        const ticket = candidate.ticket;
        if (!ticket.email) {
          stats.skipped++;
          continue;
        }

        const inCooldown = await isWithinCooldown({
          accountId,
          ruleId: rule.id,
          ticketId: ticket.id,
          cooldownDays: rule.cooldownDays,
          now,
        });
        if (inCooldown) {
          stats.skipped++;
          continue;
        }

        let voucher: { code: string; expiresAt: Date | null; discountPercent: number | null; id: number } | null = null;
        if (rule.createVoucher) {
          const expiresAt = rule.voucherValidDays
            ? addDays(startOfDay(now), rule.voucherValidDays)
            : null;
          const code = buildVoucherCode("EMP");
          const v = await prisma.voucher.create({
            data: {
              accountId,
              code,
              ticketTypeName: rule.voucherTicketTypeName,
              discountPercent: rule.voucherDiscountPercent,
              expiresAt,
              sourceTicketId: ticket.id,
              notes: `Email-Regel: ${rule.name}`,
            },
            select: { id: true, code: true, expiresAt: true, discountPercent: true },
          });
          voucher = v;
        }

        const vars = buildTemplateVars({
          candidate,
          accountName: account.name,
          rule,
          voucher,
          brand: {
            color: config.brandColor,
            logo: config.logoUrl,
            website: config.websiteUrl,
          },
        });

        const subject = renderTemplate(rule.subject, vars);
        const innerHtml = renderTemplate(rule.bodyHtml, vars);
        const html = wrapEmailHtml({
          innerHtml,
          brandColor: config.brandColor,
          logoUrl: config.logoUrl,
          websiteUrl: config.websiteUrl,
          accountName: account.name,
          preheader: subject,
        });

        const result = await sendEmail({
          config: provider,
          to: ticket.email,
          subject,
          html,
        });

        await prisma.emailSend.create({
          data: {
            accountId,
            ruleId: rule.id,
            ticketId: ticket.id,
            voucherId: voucher?.id ?? null,
            to: ticket.email,
            subject,
            status: result.ok ? "SENT" : "FAILED",
            errorMessage: result.ok ? null : (result.error?.slice(0, 500) ?? "unbekannter Fehler"),
          },
        });

        if (result.ok) {
          stats.sent++;
          totalSent++;
        } else {
          stats.failed++;
          stats.errors.push({ ticketId: ticket.id, error: result.error ?? "unbekannt" });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.errors.push({ ticketId: -1, error: `Regel-Fehler: ${msg}` });
    }

    ruleStats.push(stats);
  }

  return { accountId, ok: true, ruleStats, totalSent };
}
