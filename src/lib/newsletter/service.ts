import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/day-guest";
import { appOrigin } from "@/lib/rider-invite";
import {
  confirmMailBlocks, parseBlocks, renderNewsletterHtml, renderNewsletterText, unsubscribeMailBlocks,
  type NewsletterBlock, type NewsletterBrand,
} from "./blocks";
import { buildRawMail } from "./mime";
import {
  confirmLink, defaultConsentText, linkBase, nextConfirmMailCount, readinessGaps, reasonLine, subscribeAction,
  unsubscribeLink,
} from "./rules";
import { addGroupMembers, ensureSystemGroup, recipientsWhere, syncAnnyAboGroup, syncDueAnnyGroups } from "./groups";
import { SesError, sesEnv, sesErrorText, sesGetAccount, sesSendRaw, type SesEnv, type SesTag } from "./ses";
import type { SesEvent } from "./sns";
import { createLinkToken, newTokenSecret, verifyLinkToken } from "./tokens";

/**
 * Newsletter mit Datenbank: Einstellungen, Anmelden (Double-Opt-in),
 * Bestätigen, Abmelden, Versand-Warteschlange und SES-Rückmeldungen.
 * Läuft mit dem rohen Client (öffentliche Links, Cron) und filtert selbst
 * nach accountId.
 */

type ConfigRow = NonNullable<Awaited<ReturnType<typeof prisma.newsletterConfig.findUnique>>>;

/** Einstellungen des Mandanten; legt sie beim ersten Aufruf an (Versand aus). */
export async function loadNewsletterConfig(accountId: number): Promise<ConfigRow> {
  const found = await prisma.newsletterConfig.findUnique({ where: { accountId } });
  if (found) return found;
  return prisma.newsletterConfig.upsert({
    where: { accountId },
    create: { accountId, tokenSecret: newTokenSecret() },
    update: {},
  });
}

export interface SendContext {
  accountId: number;
  accountName: string;
  config: ConfigRow;
  brand: NewsletterBrand;
  base: string;
  env: SesEnv | null;
  gaps: string[];
}

export async function loadSendContext(accountId: number): Promise<SendContext> {
  const [config, account, mail] = await Promise.all([
    loadNewsletterConfig(accountId),
    prisma.account.findUnique({ where: { id: accountId }, select: { name: true } }),
    prisma.emailConfig.findUnique({
      where: { accountId },
      select: { logoUrl: true, websiteUrl: true, legalFooter: true },
    }),
  ]);
  const accountName = account?.name ?? "Newsletter";
  const env = sesEnv();
  return {
    accountId,
    accountName,
    config,
    brand: {
      accountName,
      // Eigene Farben des Newsletters (leer: wie die Website), nicht die
      // Brand-Farbe der übrigen Mails.
      color: config.brandColor ?? null,
      accentColor: config.accentColor ?? null,
      logoUrl: config.logoUrl ?? mail?.logoUrl ?? null,
      websiteUrl: mail?.websiteUrl ?? null,
      legalFooter: mail?.legalFooter ?? null,
    },
    base: linkBase(config.linkBaseUrl, appOrigin() ?? "https://www.emp-access.de"),
    env,
    gaps: readinessGaps({ enabled: config.enabled, fromEmail: config.fromEmail, hasSesCredentials: !!env }),
  };
}

function tags(ctx: SendContext, kind: "campaign" | "confirm" | "test" | "unsub", extra: Record<string, string | number> = {}): SesTag[] {
  return [
    { Name: "acc", Value: String(ctx.accountId) },
    { Name: "kind", Value: kind },
    ...Object.entries(extra).map(([Name, v]) => ({ Name, Value: String(v) })),
  ];
}

async function sendOne(
  ctx: SendContext,
  args: { to: string; subject: string; html: string; text: string; unsubscribeUrl: string | null; tags: SesTag[] },
): Promise<string> {
  if (!ctx.env || !ctx.config.fromEmail) throw new SesError("SES ist nicht eingerichtet", "NotConfigured", 0, "stop");
  const raw = await buildRawMail({
    fromEmail: ctx.config.fromEmail,
    fromName: ctx.config.fromName || ctx.accountName,
    to: args.to,
    replyTo: ctx.config.replyTo,
    subject: args.subject,
    html: args.html,
    text: args.text,
    unsubscribeUrl: args.unsubscribeUrl,
  });
  return sesSendRaw(ctx.env, {
    from: ctx.config.fromEmail,
    to: args.to,
    raw,
    configurationSet: ctx.config.configurationSet,
    tags: args.tags,
  });
}

// ---------------------------------------------------------------------------
// Anmelden und Bestätigungsmail
// ---------------------------------------------------------------------------

export interface SubscribeInput {
  email: unknown;
  name?: unknown;
  source: string;
  ip?: string | null;
  userAgent?: string | null;
  /** Wortlaut, den die Person gesehen hat; sonst der eingestellte Text. */
  consentText?: string | null;
  customerId?: number | null;
}

export type SubscribeResult = "pending" | "active" | "throttled" | "invalid";

function clip(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

/**
 * Anmeldung mit Double-Opt-in. Antwortet nach außen immer gleich; das
 * Ergebnis ist nur für Protokoll und Tests.
 */
export async function subscribe(accountId: number, input: SubscribeInput, now: Date = new Date()): Promise<SubscribeResult> {
  const email = normalizeEmail(input.email);
  if (!email) return "invalid";
  const existing = await prisma.newsletterSubscriber.findUnique({ where: { accountId_email: { accountId, email } } });
  const action = subscribeAction(existing, now);
  if (existing && input.source === "website") await joinWebsiteGroup(accountId, existing.id);
  if (action === "active") return "active";
  if (action === "throttled") return "throttled";

  const ctx = await loadSendContext(accountId);
  const consent = {
    consentText: clip(input.consentText, 2_000) ?? ctx.config.consentText ?? defaultConsentText(ctx.accountName),
    consentAt: now,
    consentIp: clip(input.ip, 64),
    consentUserAgent: clip(input.userAgent, 300),
  };
  const name = clip(input.name, 100);
  const subscriber = existing
    ? await prisma.newsletterSubscriber.update({
        where: { id: existing.id },
        data: {
          ...consent,
          status: "PENDING",
          source: input.source,
          name: name ?? existing.name,
          customerId: input.customerId ?? existing.customerId,
          confirmedAt: null,
          unsubscribedAt: null,
          unsubscribeReason: null,
        },
      })
    : await prisma.newsletterSubscriber.create({
        data: { ...consent, accountId, email, name, source: input.source, status: "PENDING", customerId: input.customerId ?? null },
      });
  if (!existing && input.source === "website") await joinWebsiteGroup(accountId, subscriber.id);

  await sendConfirmMail(ctx, subscriber, now).catch((err) => {
    console.error("[newsletter] Bestätigungsmail fehlgeschlagen:", err instanceof Error ? err.message : err);
  });
  return "pending";
}

/** Anmeldung über die Website: in die feste Gruppe „Website“. Fehler halten die Anmeldung nicht auf. */
async function joinWebsiteGroup(accountId: number, subscriberId: number): Promise<void> {
  try {
    await addGroupMembers(accountId, await ensureSystemGroup(accountId, "website"), [subscriberId]);
  } catch (err) {
    console.error("[newsletter] Gruppe Website:", err instanceof Error ? err.message : err);
  }
}

/**
 * Bestätigungsmail senden. Ohne SES (oder Versand aus) bleibt
 * confirmMailSentAt leer; der Cron holt das nach, sobald alles bereit ist.
 */
export async function sendConfirmMail(
  ctx: SendContext,
  s: { id: number; email: string; confirmMailSentAt: Date | null; confirmMailCount: number },
  now: Date = new Date(),
): Promise<boolean> {
  if (ctx.gaps.length) return false;
  const token = createLinkToken(ctx.config.tokenSecret, { purpose: "c", accountId: ctx.accountId, subscriberId: s.id, campaignId: 0 }, now);
  const url = confirmLink(ctx.base, token);
  const blocks = confirmMailBlocks(ctx.accountName, url);
  const render = { brand: ctx.brand };
  await sendOne(ctx, {
    to: s.email,
    subject: `Bitte bestätige deine Anmeldung zum Newsletter von ${ctx.accountName}`,
    html: renderNewsletterHtml(blocks, render),
    text: renderNewsletterText(blocks, render),
    unsubscribeUrl: null,
    tags: tags(ctx, "confirm", { sub: s.id }),
  });
  await prisma.newsletterSubscriber.update({
    where: { id: s.id },
    data: { confirmMailSentAt: now, confirmMailCount: nextConfirmMailCount(s, now) },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Öffentliche Links: Bestätigen und Abmelden
// ---------------------------------------------------------------------------

export interface LinkTarget {
  ctx: SendContext;
  subscriber: { id: number; email: string; status: string };
  campaignId: number;
}

/** Token prüfen und Abonnent laden; null bei ungültigem Link. */
export async function resolveLink(token: unknown, purpose: "c" | "u"): Promise<LinkTarget | null> {
  if (typeof token !== "string") return null;
  const head = /^[cu]\.(\d{1,9})\./.exec(token.trim());
  if (!head) return null;
  const accountId = Number(head[1]);
  const config = await prisma.newsletterConfig.findUnique({ where: { accountId } });
  if (!config) return null;
  const t = verifyLinkToken(config.tokenSecret, token, purpose);
  if (!t) return null;
  const subscriber = await prisma.newsletterSubscriber.findFirst({
    where: { id: t.subscriberId, accountId },
    select: { id: true, email: true, status: true },
  });
  if (!subscriber) return null;
  return { ctx: await loadSendContext(accountId), subscriber, campaignId: t.campaignId };
}

export async function confirmSubscriber(target: LinkTarget, ip: string | null, now: Date = new Date()): Promise<"confirmed" | "already" | "gone"> {
  if (target.subscriber.status === "ACTIVE") return "already";
  if (target.subscriber.status !== "PENDING") return "gone";
  const r = await prisma.newsletterSubscriber.updateMany({
    where: { id: target.subscriber.id, status: "PENDING" },
    data: { status: "ACTIVE", confirmedAt: now, confirmIp: ip ? ip.slice(0, 64) : null },
  });
  return r.count > 0 ? "confirmed" : "already";
}

/**
 * Abmeldeseite ohne Link: Mandant aus dem Formular (`a`) oder, wenn nur einer
 * den Newsletter eingerichtet hat, dieser. Sonst null.
 */
export async function publicNewsletterAccount(raw: unknown): Promise<number | null> {
  const n = typeof raw === "string" ? Number(raw) : NaN;
  if (Number.isInteger(n) && n > 0) {
    const c = await prisma.newsletterConfig.findUnique({ where: { accountId: n }, select: { accountId: true } });
    return c?.accountId ?? null;
  }
  const configs = await prisma.newsletterConfig.findMany({ where: { fromEmail: { not: null } }, select: { accountId: true }, take: 2 });
  return configs.length === 1 ? configs[0].accountId : null;
}

/**
 * Abmeldelink per Mail schicken, wenn die Adresse angemeldet ist. Nach außen
 * antwortet die Seite immer gleich, damit niemand prüfen kann, wer angemeldet
 * ist. Ergebnis nur für Protokoll und Tests.
 */
export async function sendUnsubscribeLink(
  accountId: number,
  rawEmail: unknown,
  now: Date = new Date(),
): Promise<"sent" | "unknown" | "invalid" | "not-ready"> {
  const email = normalizeEmail(rawEmail);
  if (!email) return "invalid";
  const s = await prisma.newsletterSubscriber.findUnique({
    where: { accountId_email: { accountId, email } },
    select: { id: true, email: true, status: true },
  });
  if (!s || (s.status !== "ACTIVE" && s.status !== "PENDING")) return "unknown";
  const ctx = await loadSendContext(accountId);
  if (!ctx.env || !ctx.config.fromEmail) return "not-ready";
  const token = createLinkToken(ctx.config.tokenSecret, { purpose: "u", accountId, subscriberId: s.id, campaignId: 0 }, now);
  const blocks = unsubscribeMailBlocks(ctx.accountName, unsubscribeLink(ctx.base, token));
  const render = { brand: ctx.brand };
  await sendOne(ctx, {
    to: s.email,
    subject: `Newsletter von ${ctx.accountName} abbestellen`,
    html: renderNewsletterHtml(blocks, render),
    text: renderNewsletterText(blocks, render),
    unsubscribeUrl: null,
    tags: tags(ctx, "unsub", { sub: s.id }),
  });
  return "sent";
}

export async function unsubscribeSubscriber(
  target: LinkTarget,
  reason: "link" | "one-click" | "verwaltung",
  now: Date = new Date(),
): Promise<"done" | "already"> {
  if (target.subscriber.status !== "ACTIVE" && target.subscriber.status !== "PENDING") return "already";
  await prisma.newsletterSubscriber.update({
    where: { id: target.subscriber.id },
    data: { status: "UNSUBSCRIBED", unsubscribedAt: now, unsubscribeReason: reason },
  });
  if (target.campaignId > 0) {
    await prisma.newsletterSend.updateMany({
      where: { campaignId: target.campaignId, subscriberId: target.subscriber.id, accountId: target.ctx.accountId },
      data: { unsubscribedAt: now },
    });
  }
  return "done";
}

// ---------------------------------------------------------------------------
// Aussendung: rendern, testen, in die Warteschlange stellen
// ---------------------------------------------------------------------------

export function campaignBlocks(raw: unknown): NewsletterBlock[] {
  const parsed = parseBlocks(raw);
  return "blocks" in parsed ? parsed.blocks : [];
}

function renderFor(
  ctx: SendContext,
  campaign: { id: number; preheader: string | null; blocks: unknown },
  subscriberId: number,
  source: string | null = null,
): { html: string; text: string; unsubscribeUrl: string } {
  const token = createLinkToken(ctx.config.tokenSecret, {
    purpose: "u",
    accountId: ctx.accountId,
    subscriberId,
    campaignId: campaign.id,
  });
  const unsubscribeUrl = unsubscribeLink(ctx.base, token);
  const render = {
    brand: ctx.brand,
    preheader: campaign.preheader,
    unsubscribeUrl,
    reason: reasonLine(ctx.accountName, source),
  };
  const blocks = campaignBlocks(campaign.blocks);
  return { html: renderNewsletterHtml(blocks, render), text: renderNewsletterText(blocks, render), unsubscribeUrl };
}

/**
 * Testmail an bis zu fünf Adressen. Der Abmeldelink zeigt auf eine leere
 * Seite (kein echter Abonnent). In der SES-Sandbox müssen die Empfänger in
 * SES bestätigt sein.
 */
export async function sendTestMail(
  accountId: number,
  campaign: { id: number; subject: string; preheader: string | null; blocks: unknown },
  recipients: string[],
): Promise<{ sent: string[]; failed: Array<{ to: string; error: string }> }> {
  const ctx = await loadSendContext(accountId);
  const sent: string[] = [];
  const failed: Array<{ to: string; error: string }> = [];
  for (const to of recipients.slice(0, 5)) {
    try {
      const { html, text } = renderFor(ctx, campaign, 0);
      await sendOne(ctx, {
        to,
        subject: `[Test] ${campaign.subject}`,
        html,
        text,
        unsubscribeUrl: null,
        tags: tags(ctx, "test", { camp: campaign.id }),
      });
      sent.push(to);
    } catch (err) {
      failed.push({ to, error: sesErrorText(err) });
    }
  }
  return { sent, failed };
}

/**
 * Aussendung starten: alle angemeldeten Abonnenten der gewählten Gruppen
 * (ohne Gruppen: alle angemeldeten) in die Warteschlange. Der Cron
 * (/api/cron/newsletter) verschickt sie in Raten.
 */
export async function queueCampaign(
  accountId: number,
  campaignId: number,
  now: Date = new Date(),
): Promise<{ recipients: number } | { error: string; status: number }> {
  const ctx = await loadSendContext(accountId);
  if (ctx.gaps.length) return { error: `Versand nicht bereit: ${ctx.gaps.join(", ")}`, status: 409 };
  const campaign = await prisma.newsletterCampaign.findFirst({ where: { id: campaignId, accountId } });
  if (!campaign) return { error: "Aussendung nicht gefunden", status: 404 };
  if (campaign.status !== "DRAFT") return { error: "Diese Aussendung wurde schon gestartet", status: 409 };
  if (campaignBlocks(campaign.blocks).length === 0) return { error: "Die Aussendung hat keinen Inhalt", status: 400 };
  const groupIds = campaign.groupIds ?? [];
  if (groupIds.length) {
    const known = await prisma.newsletterGroup.count({ where: { accountId, id: { in: groupIds } } });
    if (known !== groupIds.length) return { error: "Eine gewählte Gruppe gibt es nicht mehr. Bitte die Empfänger neu wählen.", status: 409 };
  }

  if (ctx.env) {
    const account = await sesGetAccount(ctx.env).catch(() => null);
    if (account && !account.productionAccessEnabled) {
      return {
        error: "SES ist noch in der Sandbox: Mails gehen nur an bestätigte Adressen. Bitte zuerst den Produktivbetrieb bei AWS beantragen.",
        status: 409,
      };
    }
  }

  // Erst den Status setzen (nur einmal möglich), dann die Empfänger anlegen.
  const claimed = await prisma.newsletterCampaign.updateMany({
    where: { id: campaignId, accountId, status: "DRAFT" },
    data: { status: "QUEUED", queuedAt: now, lastError: null, lastErrorAt: null },
  });
  if (claimed.count === 0) return { error: "Diese Aussendung wurde schon gestartet", status: 409 };

  // Abo-Kunden aus anny auf den neuesten Stand bringen (nur wenn eingeschaltet).
  await syncAnnyAboGroup(accountId, now).catch((err) => {
    console.error("[newsletter] Abgleich anny-Abos vor dem Versand:", err instanceof Error ? err.message : err);
  });
  const subscribers = await prisma.newsletterSubscriber.findMany({
    where: recipientsWhere(accountId, groupIds),
    select: { id: true, email: true },
    orderBy: { id: "asc" },
  });
  for (let i = 0; i < subscribers.length; i += 1_000) {
    await prisma.newsletterSend.createMany({
      data: subscribers.slice(i, i + 1_000).map((s) => ({ accountId, campaignId, subscriberId: s.id, email: s.email })),
      skipDuplicates: true,
    });
  }
  await prisma.newsletterCampaign.update({ where: { id: campaignId }, data: { recipients: subscribers.length } });
  return { recipients: subscribers.length };
}

export async function cancelCampaign(accountId: number, campaignId: number, now: Date = new Date()): Promise<boolean> {
  const r = await prisma.newsletterCampaign.updateMany({
    where: { id: campaignId, accountId, status: { in: ["QUEUED", "SENDING"] } },
    data: { status: "CANCELLED", finishedAt: now },
  });
  if (r.count === 0) return false;
  await prisma.newsletterSend.updateMany({
    where: { campaignId, accountId, status: "QUEUED" },
    data: { status: "SKIPPED", error: "Versand abgebrochen" },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Cron: Warteschlange abarbeiten
// ---------------------------------------------------------------------------

/** Höchstens so viele Mails je Sekunde, auch wenn SES mehr erlaubt. */
const MAX_RATE = 10;
/** Nach so vielen vorübergehenden Fehlern gilt eine Mail als gescheitert. */
const MAX_ATTEMPTS = 5;
/** Übernommene, aber nicht abgeschlossene Mails nach so langer Zeit freigeben. */
const STALE_CLAIM_MS = 15 * 60 * 1000;
/** Nach einem Fehler, der alles anhält, so lange warten. */
const STOP_BACKOFF_MS = 10 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TickSummary {
  skipped?: string;
  confirmMails: number;
  sent: number;
  failed: number;
  retried: number;
  finished: number[];
  stopped: Array<{ campaignId: number; error: string }>;
  /** Mandanten, deren Gruppe „Abos aus anny“ abgeglichen wurde. */
  annySynced: number;
}

export async function runNewsletterTick(budgetMs = 45_000, now: Date = new Date()): Promise<TickSummary> {
  const summary: TickSummary = { confirmMails: 0, sent: 0, failed: 0, retried: 0, finished: [], stopped: [], annySynced: 0 };
  // 0) Gruppe „Abos aus anny“ stündlich abgleichen, auch ohne SES.
  summary.annySynced = await syncDueAnnyGroups(now).catch((err) => {
    console.error("[newsletter] Abgleich anny-Abos:", err instanceof Error ? err.message : err);
    return 0;
  });
  const env = sesEnv();
  if (!env) return { ...summary, skipped: "SES nicht eingerichtet" };
  const deadline = Date.now() + budgetMs;

  // 1) Bestätigungsmails nachholen (Anmeldungen, als SES noch nicht bereit war).
  const waiting = await prisma.newsletterSubscriber.findMany({
    where: { status: "PENDING", confirmMailSentAt: null, consentAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
    select: { id: true, accountId: true, email: true, confirmMailSentAt: true, confirmMailCount: true },
    orderBy: { id: "asc" },
    take: 50,
  });
  const ctxCache = new Map<number, SendContext>();
  const ctxFor = async (accountId: number) => {
    let c = ctxCache.get(accountId);
    if (!c) {
      c = await loadSendContext(accountId);
      ctxCache.set(accountId, c);
    }
    return c;
  };
  for (const s of waiting) {
    const ctx = await ctxFor(s.accountId);
    if (ctx.gaps.length) continue;
    try {
      if (await sendConfirmMail(ctx, s, now)) summary.confirmMails++;
    } catch (err) {
      console.error("[newsletter] Bestätigungsmail (Cron) fehlgeschlagen:", err instanceof Error ? err.message : err);
    }
  }

  // 2) Aussendungen.
  const campaigns = await prisma.newsletterCampaign.findMany({
    where: { status: { in: ["QUEUED", "SENDING"] } },
    select: { id: true, accountId: true, status: true, subject: true, preheader: true, blocks: true, lastErrorAt: true },
    orderBy: { queuedAt: "asc" },
    take: 5,
  });
  if (campaigns.length === 0) return summary;

  const account = await sesGetAccount(env).catch(() => null);
  if (account && (!account.sendingEnabled || !account.productionAccessEnabled)) {
    return { ...summary, skipped: account.sendingEnabled ? "SES in der Sandbox" : "SES-Versand ist pausiert" };
  }
  const rate = Math.max(1, Math.min(MAX_RATE, Math.floor(account?.maxSendRate ?? 1)));

  for (const campaign of campaigns) {
    if (Date.now() > deadline) break;
    if (campaign.lastErrorAt && now.getTime() - campaign.lastErrorAt.getTime() < STOP_BACKOFF_MS) continue;
    const ctx = await ctxFor(campaign.accountId);
    if (ctx.gaps.length) continue;

    if (campaign.status === "QUEUED") {
      await prisma.newsletterCampaign.updateMany({
        where: { id: campaign.id, status: "QUEUED" },
        data: { status: "SENDING", startedAt: now },
      });
    }
    await prisma.newsletterSend.updateMany({
      where: { campaignId: campaign.id, status: "SENDING", claimedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
      data: { status: "QUEUED", claimedAt: null },
    });

    const stop: { error: string | null } = { error: null };
    while (!stop.error && Date.now() + 2_000 < deadline) {
      const batch = await prisma.$queryRaw<Array<{ id: number; subscriberId: number; email: string; attempts: number }>>`
        UPDATE "NewsletterSend" SET "status" = 'SENDING', "claimedAt" = NOW(), "attempts" = "attempts" + 1
        WHERE "id" IN (
          SELECT "id" FROM "NewsletterSend"
          WHERE "campaignId" = ${campaign.id} AND "status" = 'QUEUED'
          ORDER BY "id" LIMIT ${rate}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING "id", "subscriberId", "email", "attempts"`;
      if (batch.length === 0) break;

      const started = Date.now();
      const active = new Map(
        (
          await prisma.newsletterSubscriber.findMany({
            where: { id: { in: batch.map((b) => b.subscriberId) }, accountId: campaign.accountId, status: "ACTIVE" },
            select: { id: true, source: true },
          })
        ).map((s) => [s.id, s.source]),
      );

      const results = await Promise.all(
        batch.map(async (row) => {
          if (!active.has(row.subscriberId)) {
            await prisma.newsletterSend.update({
              where: { id: row.id },
              data: { status: "SKIPPED", error: "Nicht mehr angemeldet", claimedAt: null },
            });
            return "skipped" as const;
          }
          try {
            const { html, text, unsubscribeUrl } = renderFor(ctx, campaign, row.subscriberId, active.get(row.subscriberId));
            const messageId = await sendOne(ctx, {
              to: row.email,
              subject: campaign.subject,
              html,
              text,
              unsubscribeUrl,
              tags: tags(ctx, "campaign", { camp: campaign.id, send: row.id, sub: row.subscriberId }),
            });
            await prisma.newsletterSend.update({
              where: { id: row.id },
              data: { status: "SENT", sentAt: new Date(), sesMessageId: messageId, error: null },
            });
            return "sent" as const;
          } catch (err) {
            const e = err instanceof SesError ? err : new SesError(String(err), "Unknown", 0, "retry");
            const reason = sesErrorText(e);
            if (e.kind === "stop") {
              stop.error = reason;
              await prisma.newsletterSend.update({
                where: { id: row.id },
                data: { status: "QUEUED", claimedAt: null, attempts: { decrement: 1 }, error: reason.slice(0, 300) },
              });
              return "stopped" as const;
            }
            const giveUp = e.kind === "recipient" || row.attempts >= MAX_ATTEMPTS;
            await prisma.newsletterSend.update({
              where: { id: row.id },
              data: giveUp
                ? { status: "FAILED", error: reason.slice(0, 300), claimedAt: null }
                : { status: "QUEUED", error: reason.slice(0, 300), claimedAt: null },
            });
            return giveUp ? ("failed" as const) : ("retried" as const);
          }
        }),
      );
      for (const r of results) {
        if (r === "sent") summary.sent++;
        else if (r === "failed") summary.failed++;
        else if (r === "retried") summary.retried++;
      }
      const sentIds = batch.filter((_, i) => results[i] === "sent").map((b) => b.subscriberId);
      if (sentIds.length) {
        await prisma.newsletterSubscriber.updateMany({ where: { id: { in: sentIds } }, data: { lastSentAt: new Date() } });
      }
      // Rate halten: eine Runde je Sekunde.
      const wait = 1_000 - (Date.now() - started);
      if (wait > 0) await sleep(wait);
    }

    if (stop.error) {
      await prisma.newsletterCampaign.update({
        where: { id: campaign.id },
        data: { lastError: stop.error.slice(0, 500), lastErrorAt: new Date() },
      });
      summary.stopped.push({ campaignId: campaign.id, error: stop.error });
      break;
    }

    const open = await prisma.newsletterSend.count({
      where: { campaignId: campaign.id, status: { in: ["QUEUED", "SENDING"] } },
    });
    if (open === 0) {
      await prisma.newsletterCampaign.updateMany({
        where: { id: campaign.id, status: { in: ["QUEUED", "SENDING"] } },
        data: { status: "SENT", finishedAt: new Date(), lastError: null, lastErrorAt: null },
      });
      summary.finished.push(campaign.id);
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// SES-Rückmeldungen (über SNS)
// ---------------------------------------------------------------------------

export async function applySesEvent(accountId: number, e: SesEvent): Promise<string> {
  if (e.kind === "other") return "ignoriert";
  if (e.tags.acc && e.tags.acc !== String(accountId)) return "fremder Mandant";

  const sendId = Number(e.tags.send);
  const send =
    Number.isInteger(sendId) && sendId > 0
      ? await prisma.newsletterSend.findFirst({ where: { id: sendId, accountId } })
      : e.messageId
        ? await prisma.newsletterSend.findFirst({ where: { sesMessageId: e.messageId, accountId } })
        : null;

  const subId = Number(e.tags.sub);
  const subscriberWhere =
    send ? { id: send.subscriberId, accountId }
    : Number.isInteger(subId) && subId > 0 ? { id: subId, accountId }
    : e.recipients[0] ? { accountId, email: e.recipients[0] }
    : null;

  switch (e.kind) {
    case "delivery":
      if (send && send.status === "SENT") {
        await prisma.newsletterSend.update({ where: { id: send.id }, data: { status: "DELIVERED", eventAt: e.at } });
      }
      return "zugestellt";
    case "bounce":
      if (!e.permanent) {
        if (send) await prisma.newsletterSend.update({ where: { id: send.id }, data: { eventAt: e.at, error: e.detail } });
        return "vorübergehend";
      }
      if (send) await prisma.newsletterSend.update({ where: { id: send.id }, data: { status: "BOUNCED", eventAt: e.at, error: e.detail } });
      if (subscriberWhere) {
        await prisma.newsletterSubscriber.updateMany({
          where: { ...subscriberWhere, status: { in: ["ACTIVE", "PENDING"] } },
          data: { status: "BOUNCED", bouncedAt: e.at, unsubscribeReason: "bounce" },
        });
      }
      return "unzustellbar";
    case "complaint":
      if (send) await prisma.newsletterSend.update({ where: { id: send.id }, data: { status: "COMPLAINED", eventAt: e.at, error: e.detail } });
      if (subscriberWhere) {
        await prisma.newsletterSubscriber.updateMany({
          where: { ...subscriberWhere, status: { not: "COMPLAINED" } },
          data: { status: "COMPLAINED", complainedAt: e.at, unsubscribeReason: "complaint" },
        });
      }
      return "beschwerde";
    case "reject":
      if (send) await prisma.newsletterSend.update({ where: { id: send.id }, data: { status: "FAILED", eventAt: e.at, error: e.detail } });
      return "abgelehnt";
  }
}
