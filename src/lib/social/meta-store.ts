import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appOrigin } from "@/lib/rider-invite";
import { openSecret, sealSecret } from "@/lib/secret-box";
import {
  META_CHANNELS, META_REQUIRED_SCOPES, META_SCOPES, MetaApiError, fetchMetaStats, graphClient, isRetryable, listPages, metaConfig,
  metaErrorText, metaRedirectUri, publishToMeta, type MetaPage, type MetaTarget, type PublishResult,
} from "./meta";
import type { SocialChannel, SocialFormat } from "./rules";

/**
 * Datenbank-Seite der Meta-Schnittstelle: Verbindung je Mandant (Tokens nur
 * verschlüsselt), Posten mit Sperre gegen Doppelposts, Zahlen abrufen und der
 * Cron-Job für Beiträge mit „automatisch posten“.
 */

const LOCK_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
/** Ältere verpasste Termine werden nicht mehr automatisch gepostet. */
const LATE_LIMIT_MS = 24 * 60 * 60 * 1000;
const STATS_EVERY_MS = 6 * 60 * 60 * 1000;
const STATS_DAYS = 30;

export interface PageChoice {
  id: string;
  name: string;
  igUsername: string | null;
}

export interface MetaStatus {
  /** META_APP_ID und META_APP_SECRET gesetzt. */
  configured: boolean;
  redirectUri: string | null;
  connected: boolean;
  pageName: string | null;
  /** Instagram-Profil mit der Seite verknüpft. */
  instagram: boolean;
  igUsername: string | null;
  /** Nach dem Anmelden mehrere Seiten: eine wählen. */
  pageChoices: PageChoice[];
  missingScopes: string[];
  connectedAt: string | null;
  connectedBy: string | null;
  lastError: string | null;
  statsSyncAt: string | null;
}

export function metaOrigin(fallback?: string): string | null {
  return appOrigin() ?? fallback ?? null;
}

function choicesFrom(raw: unknown): PageChoice[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is { id: unknown; name: unknown; igUsername?: unknown } => !!c && typeof c === "object")
    .map((c) => ({ id: String(c.id), name: String(c.name ?? c.id), igUsername: typeof c.igUsername === "string" ? c.igUsername : null }))
    .filter((c) => /^\d+$/.test(c.id));
}

export async function loadMetaStatus(accountId: number): Promise<MetaStatus> {
  const cfg = metaConfig();
  const origin = metaOrigin();
  const row = await prisma.socialMetaConnection.findUnique({ where: { accountId } });
  const connected = !!row?.pageId && !!row.pageToken;
  return {
    configured: !!cfg,
    redirectUri: origin ? metaRedirectUri(origin) : null,
    connected,
    pageName: row?.pageName ?? null,
    instagram: connected && !!row?.igUserId,
    igUsername: row?.igUsername ?? null,
    pageChoices: connected ? [] : choicesFrom(row?.pageChoices),
    missingScopes: row ? META_SCOPES.filter((s) => !row.scopes.includes(s)) : [],
    connectedAt: connected ? row.connectedAt.toISOString() : null,
    connectedBy: row?.connectedBy ?? null,
    lastError: row?.lastError ?? null,
    statsSyncAt: row?.statsSyncAt?.toISOString() ?? null,
  };
}

/** Ziel zum Posten, oder null ohne vollständige Verbindung. */
export async function loadMetaTarget(accountId: number): Promise<MetaTarget | null> {
  const row = await prisma.socialMetaConnection.findUnique({
    where: { accountId },
    select: { pageId: true, pageToken: true, igUserId: true },
  });
  const token = openSecret(row?.pageToken);
  if (!row?.pageId || !token) return null;
  return { pageId: row.pageId, pageToken: token, igUserId: row.igUserId };
}

async function savePage(accountId: number, page: MetaPage, extra: { scopes?: string[]; by?: string | null } = {}) {
  const data = {
    pageId: page.id,
    pageName: page.name.slice(0, 200),
    pageToken: sealSecret(page.token),
    igUserId: page.igUserId,
    igUsername: page.igUsername,
    userToken: null,
    pageChoices: Prisma.DbNull,
    lastError: null,
    lastErrorAt: null,
    connectedAt: new Date(),
    ...(extra.scopes ? { scopes: extra.scopes } : {}),
    ...(extra.by !== undefined ? { connectedBy: extra.by } : {}),
  };
  await prisma.socialMetaConnection.upsert({ where: { accountId }, create: { accountId, ...data }, update: data });
}

/**
 * Ergebnis des Anmeldens speichern. Eine Seite: sofort verbunden.
 * Mehrere: Nutzer-Token verschlüsselt behalten, bis eine gewählt ist.
 */
export async function saveMetaLogin(
  accountId: number,
  login: { userToken: string; scopes: string[]; pages: MetaPage[]; by: string | null },
): Promise<"connected" | "choose" | "no-page" | "missing-scopes"> {
  const missing = META_REQUIRED_SCOPES.filter((s) => !login.scopes.includes(s));
  const base = { scopes: login.scopes, connectedBy: login.by, lastErrorAt: new Date() };
  if (missing.length) {
    await prisma.socialMetaConnection.upsert({
      where: { accountId },
      create: { accountId, ...base, lastError: `Rechte fehlen: ${missing.join(", ")}` },
      update: { ...base, lastError: `Rechte fehlen: ${missing.join(", ")}` },
    });
    return "missing-scopes";
  }
  if (login.pages.length === 0) {
    await prisma.socialMetaConnection.upsert({
      where: { accountId },
      create: { accountId, ...base, lastError: "Keine Facebook-Seite freigegeben" },
      update: { ...base, lastError: "Keine Facebook-Seite freigegeben" },
    });
    return "no-page";
  }
  if (login.pages.length === 1) {
    await savePage(accountId, login.pages[0], { scopes: login.scopes, by: login.by });
    return "connected";
  }
  const choices: PageChoice[] = login.pages.map((p) => ({ id: p.id, name: p.name, igUsername: p.igUsername }));
  const pending = {
    userToken: sealSecret(login.userToken),
    pageChoices: choices as unknown as Prisma.InputJsonValue,
    scopes: login.scopes,
    connectedBy: login.by,
    pageId: null,
    pageName: null,
    pageToken: null,
    igUserId: null,
    igUsername: null,
    lastError: null,
    lastErrorAt: null,
  };
  await prisma.socialMetaConnection.upsert({ where: { accountId }, create: { accountId, ...pending }, update: pending });
  return "choose";
}

/** Seite aus der Auswahl übernehmen. */
export async function chooseMetaPage(accountId: number, pageId: string): Promise<{ ok: true } | { error: string }> {
  const cfg = metaConfig();
  if (!cfg) return { error: "Meta ist nicht eingerichtet" };
  const row = await prisma.socialMetaConnection.findUnique({ where: { accountId }, select: { userToken: true } });
  const userToken = openSecret(row?.userToken);
  if (!userToken) return { error: "Die Anmeldung ist abgelaufen. Bitte neu verbinden." };
  try {
    const pages = await listPages(graphClient(cfg), userToken);
    const page = pages.find((p) => p.id === pageId);
    if (!page) return { error: "Diese Seite ist nicht freigegeben" };
    await savePage(accountId, page);
    return { ok: true };
  } catch (err) {
    return { error: metaErrorText(err) };
  }
}

export async function disconnectMeta(accountId: number): Promise<void> {
  await prisma.socialMetaConnection.deleteMany({ where: { accountId } });
  // Automatisches Posten ohne Verbindung abschalten, damit nach dem neuen Verbinden nichts Altes losgeht.
  await prisma.socialPost.updateMany({ where: { accountId, autoPublish: true, externalId: null }, data: { autoPublish: false } });
}

async function noteConnectionError(accountId: number, err: unknown) {
  if (!(err instanceof MetaApiError) || !err.tokenInvalid) return;
  await prisma.socialMetaConnection.updateMany({ where: { accountId }, data: { lastError: metaErrorText(err), lastErrorAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Posten

export type PublishOutcome =
  | { ok: true; result: PublishResult }
  | { ok: false; error: string; status: number };

/**
 * Beitrag über Meta veröffentlichen. Die Sperre (publishLockedAt) verhindert,
 * dass Taste und Cron denselben Beitrag gleichzeitig posten.
 */
export async function publishSocialPost(
  accountId: number,
  postId: number,
  opts: { waitMs?: number; now?: Date; fromCron?: boolean } = {},
): Promise<PublishOutcome> {
  const cfg = metaConfig();
  if (!cfg) return { ok: false, error: "Meta ist nicht eingerichtet (META_APP_ID/META_APP_SECRET fehlen)", status: 501 };
  const now = opts.now ?? new Date();
  const claimed = await prisma.socialPost.updateMany({
    where: {
      id: postId,
      accountId,
      externalId: null,
      channel: { in: [...META_CHANNELS] },
      OR: [{ publishLockedAt: null }, { publishLockedAt: { lt: new Date(now.getTime() - LOCK_MS) } }],
    },
    // Nur Versuche des Crons zählen; die Taste „Jetzt posten“ darf man öfter drücken.
    data: { publishLockedAt: now, ...(opts.fromCron ? { publishAttempts: { increment: 1 } } : {}) },
  });
  if (claimed.count === 0) {
    const post = await prisma.socialPost.findFirst({ where: { id: postId, accountId }, select: { externalId: true, channel: true } });
    if (!post) return { ok: false, error: "Nicht gefunden", status: 404 };
    if (post.externalId) return { ok: false, error: "Dieser Beitrag ist schon gepostet", status: 409 };
    if (!META_CHANNELS.includes(post.channel as SocialChannel)) return { ok: false, error: "Automatisch posten geht nur auf Instagram und Facebook", status: 400 };
    return { ok: false, error: "Der Beitrag wird gerade gepostet", status: 409 };
  }
  const post = await prisma.socialPost.findFirst({
    where: { id: postId, accountId },
    include: { campaign: { select: { hashtags: true } } },
  });
  if (!post) return { ok: false, error: "Nicht gefunden", status: 404 };
  const target = await loadMetaTarget(accountId);
  if (!target) {
    await prisma.socialPost.updateMany({
      where: { id: postId, accountId },
      data: { publishLockedAt: null, publishError: "Meta ist nicht verbunden" },
    });
    return { ok: false, error: "Meta ist nicht verbunden", status: 409 };
  }
  try {
    const result = await publishToMeta(
      graphClient(cfg),
      target,
      {
        channel: post.channel as SocialChannel,
        format: post.format as SocialFormat,
        text: post.text,
        media: post.media,
        link: post.link,
        containerId: post.containerId,
      },
      post.campaign.hashtags,
      { waitMs: opts.waitMs },
    );
    if (result.state === "PROCESSING") {
      await prisma.socialPost.updateMany({
        where: { id: postId, accountId },
        data: { containerId: result.containerId, publishLockedAt: null, publishError: null },
      });
    } else {
      await prisma.socialPost.updateMany({
        where: { id: postId, accountId },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          externalId: result.externalId,
          postUrl: result.postUrl ?? post.postUrl,
          containerId: null,
          publishLockedAt: null,
          publishError: null,
          autoPublish: false,
        },
      });
    }
    return { ok: true, result };
  } catch (err) {
    const message = metaErrorText(err);
    const retry = isRetryable(err);
    const containerFailed = err instanceof MetaApiError && err.status === 422;
    await prisma.socialPost.updateMany({
      where: { id: postId, accountId },
      data: {
        publishLockedAt: null,
        publishError: message,
        ...(containerFailed ? { containerId: null } : {}),
        // Bleibende Fehler: automatisches Posten aus, damit der Cron nicht weiter probiert.
        ...(opts.fromCron && (!retry || post.publishAttempts >= MAX_ATTEMPTS) ? { autoPublish: false } : {}),
      },
    });
    await noteConnectionError(accountId, err);
    return { ok: false, error: message, status: err instanceof MetaApiError && err.status === 400 ? 400 : 502 };
  }
}

/** Zahlen eines über Meta geposteten Beitrags abrufen und speichern. */
export async function refreshSocialPostStats(accountId: number, postId: number): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const cfg = metaConfig();
  if (!cfg) return { ok: false, error: "Meta ist nicht eingerichtet", status: 501 };
  const post = await prisma.socialPost.findFirst({
    where: { id: postId, accountId },
    select: { channel: true, format: true, externalId: true, postUrl: true, reach: true, interactions: true, clicks: true, views: true },
  });
  if (!post) return { ok: false, error: "Nicht gefunden", status: 404 };
  if (!post.externalId) return { ok: false, error: "Zahlen gibt es nur für Beiträge, die über emp-access gepostet wurden", status: 409 };
  const target = await loadMetaTarget(accountId);
  if (!target) return { ok: false, error: "Meta ist nicht verbunden", status: 409 };
  try {
    const stats = await fetchMetaStats(graphClient(cfg), target, {
      channel: post.channel as SocialChannel,
      format: post.format as SocialFormat,
      externalId: post.externalId,
    });
    await prisma.socialPost.updateMany({
      where: { id: postId, accountId },
      data: {
        // Fehlt eine Zahl bei Meta, bleibt der bisherige (z. B. von Hand eingetragene) Wert.
        reach: stats.reach ?? post.reach,
        interactions: stats.interactions ?? post.interactions,
        clicks: stats.clicks ?? post.clicks,
        views: stats.views ?? post.views,
        postUrl: stats.postUrl ?? post.postUrl,
        statsAt: new Date(),
      },
    });
    return { ok: true };
  } catch (err) {
    await noteConnectionError(accountId, err);
    return { ok: false, error: metaErrorText(err), status: 502 };
  }
}

/** Zahlen aller über Meta geposteten Beiträge der letzten 30 Tage (höchstens `limit`). */
export async function refreshRecentStats(accountId: number, opts: { now?: Date; limit?: number; staleMs?: number } = {}) {
  const now = opts.now ?? new Date();
  const posts = await prisma.socialPost.findMany({
    where: {
      accountId,
      externalId: { not: null },
      publishedAt: { gte: new Date(now.getTime() - STATS_DAYS * 86_400_000) },
      ...(opts.staleMs !== undefined ? { OR: [{ statsAt: null }, { statsAt: { lt: new Date(now.getTime() - opts.staleMs) } }] } : {}),
    },
    orderBy: { publishedAt: "desc" },
    take: opts.limit ?? 20,
    select: { id: true },
  });
  let updated = 0;
  let failed = 0;
  let lastError: string | null = null;
  for (const p of posts) {
    const r = await refreshSocialPostStats(accountId, p.id);
    if (r.ok) updated += 1;
    else {
      failed += 1;
      lastError = r.error;
    }
  }
  await prisma.socialMetaConnection.updateMany({ where: { accountId }, data: { statsSyncAt: now } });
  return { updated, failed, lastError };
}

// ---------------------------------------------------------------------------
// Cron

/** Alle fünf Minuten: fällige Beiträge posten, Videos fertig posten, Zahlen nachziehen. */
export async function runSocialMetaTick(now: Date = new Date()) {
  if (!metaConfig()) return { skipped: "nicht eingerichtet" };
  // Der Cron teilt sich 120 s mit anderen Jobs: nach 60 s aufhören, der Rest kommt beim nächsten Lauf.
  const deadline = Date.now() + 60_000;
  const connections = await prisma.socialMetaConnection.findMany({
    where: { pageId: { not: null }, pageToken: { not: null } },
    select: { accountId: true },
  });
  if (connections.length === 0) return { skipped: "keine Verbindung" };
  const accountIds = connections.map((c) => c.accountId);

  // Termin zu lange verpasst (z. B. Cron ausgefallen): nicht mehr posten, sondern melden.
  const missed = await prisma.socialPost.updateMany({
    where: {
      accountId: { in: accountIds },
      autoPublish: true,
      externalId: null,
      containerId: null,
      status: "READY",
      plannedAt: { lt: new Date(now.getTime() - LATE_LIMIT_MS) },
    },
    data: { autoPublish: false, publishError: "Termin um mehr als 24 Stunden verpasst, nicht automatisch gepostet" },
  });

  const due = await prisma.socialPost.findMany({
    where: {
      accountId: { in: accountIds },
      externalId: null,
      channel: { in: [...META_CHANNELS] },
      OR: [
        { autoPublish: true, status: "READY", plannedAt: { lte: now }, publishAttempts: { lt: MAX_ATTEMPTS } },
        // Instagram verarbeitet ein Video: fertig posten, sobald es bereit ist.
        { containerId: { not: null } },
      ],
    },
    orderBy: { plannedAt: "asc" },
    take: 5,
    select: { id: true, accountId: true },
  });
  let published = 0;
  let processing = 0;
  let failed = 0;
  for (const p of due) {
    if (Date.now() > deadline) break;
    const r = await publishSocialPost(p.accountId, p.id, { now, fromCron: true, waitMs: 4000 });
    if (!r.ok) failed += 1;
    else if (r.result.state === "PUBLISHED") published += 1;
    else processing += 1;
  }

  let stats = 0;
  for (const accountId of accountIds) {
    if (Date.now() > deadline) break;
    const r = await refreshRecentStats(accountId, { now, limit: 5, staleMs: STATS_EVERY_MS });
    stats += r.updated;
  }
  return { due: due.length, published, processing, failed, missed: missed.count, stats };
}
