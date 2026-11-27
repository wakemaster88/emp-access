import { createHmac } from "node:crypto";
import {
  IG_CAPTION_LIMIT, IG_CAROUSEL_MAX, IG_HASHTAG_LIMIT, META_CHANNELS, countHashtags, isVideoUrl, metaCaption, publishProblem,
  type PublishablePost,
} from "./meta-rules";
import type { SocialChannel, SocialFormat } from "./rules";

export {
  IG_CAPTION_LIMIT, IG_CAROUSEL_MAX, IG_HASHTAG_LIMIT, META_CHANNELS, countHashtags, isVideoUrl, metaCaption, publishProblem,
  type PublishablePost,
};

/**
 * Meta Graph API (Facebook-Seite und verknüpftes Instagram-Profil).
 *
 * Anmeldung über „Facebook Login“ der eigenen Meta-App: Aaron trägt App-ID und
 * App-Geheimnis in Vercel ein (META_APP_ID, META_APP_SECRET). Nach dem Anmelden
 * wird nur das Seiten-Token verschlüsselt gespeichert; es läuft nicht ab, solange
 * die Rechte bestehen. Jeder Aufruf schickt `appsecret_proof` mit.
 *
 * Diese Datei kennt keine Datenbank; `fetch` ist austauschbar (Tests).
 */

export const DEFAULT_GRAPH_VERSION = "v25.0";

/** Rechte für Seite und Instagram (Facebook Login). */
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "read_insights",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "business_management",
] as const;

/** Ohne diese Rechte kann nichts gepostet werden. */
export const META_REQUIRED_SCOPES = ["pages_show_list", "pages_manage_posts"] as const;

export interface MetaConfig {
  appId: string;
  appSecret: string;
  /** Konfigurations-ID für „Facebook Login for Business“ (optional, statt scope). */
  configId: string | null;
  graphVersion: string;
}

type Env = Record<string, string | undefined>;

export function metaConfig(env: Env = process.env): MetaConfig | null {
  const appId = env.META_APP_ID?.trim();
  const appSecret = env.META_APP_SECRET?.trim();
  if (!appId || !appSecret || !/^\d{5,20}$/.test(appId)) return null;
  const version = env.META_GRAPH_VERSION?.trim();
  return {
    appId,
    appSecret,
    configId: env.META_CONFIG_ID?.trim() || null,
    graphVersion: version && /^v\d{1,2}\.\d$/.test(version) ? version : DEFAULT_GRAPH_VERSION,
  };
}

/** Rücksprungadresse nach dem Anmelden; muss in der Meta-App eingetragen sein. */
export function metaRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/social/meta/callback`;
}

export function metaAuthorizeUrl(cfg: MetaConfig, redirectUri: string, state: string): string {
  const u = new URL(`https://www.facebook.com/${cfg.graphVersion}/dialog/oauth`);
  u.searchParams.set("client_id", cfg.appId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  if (cfg.configId) {
    u.searchParams.set("config_id", cfg.configId);
  } else {
    u.searchParams.set("scope", META_SCOPES.join(","));
    // Abgelehnte Rechte beim erneuten Verbinden wieder anfragen.
    u.searchParams.set("auth_type", "rerequest");
  }
  return u.toString();
}

export function appSecretProof(token: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// Fehler

export class MetaApiError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly subcode: number | null;
  /** Token abgelaufen oder Rechte entzogen: neu verbinden. */
  readonly tokenInvalid: boolean;
  /** Meta meldet einen vorübergehenden Fehler: später erneut versuchen. */
  readonly transient: boolean;

  constructor(message: string, opts: { status: number; code?: number | null; subcode?: number | null; transient?: boolean }) {
    super(message);
    this.name = "MetaApiError";
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.subcode = opts.subcode ?? null;
    this.tokenInvalid = this.code === 190 || this.code === 102 || (this.code === 10 && this.status === 403);
    this.transient = !!opts.transient || this.code === 1 || this.code === 2 || this.code === 4 || this.code === 17 || this.code === 32 || this.code === 613 || this.status >= 500;
  }
}

/** Lohnt ein späterer Versuch? (Netz, Zeitüberschreitung, vorübergehender Meta-Fehler) */
export function isRetryable(err: unknown): boolean {
  if (err instanceof MetaApiError) return err.transient && !err.tokenInvalid;
  if (err instanceof TypeError) return true;
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/** Fehlermeldung von Meta für die Oberfläche; ohne Tokens oder Adressen. */
export function metaErrorText(err: unknown): string {
  if (err instanceof MetaApiError) {
    if (err.tokenInvalid) return "Die Verbindung zu Meta ist abgelaufen oder wurde entzogen. Bitte neu verbinden.";
    return err.message;
  }
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return "Meta antwortet nicht (Zeitüberschreitung)";
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) return "Meta ist gerade nicht erreichbar. Bitte später noch einmal versuchen.";
  if (err instanceof Error) return err.message.slice(0, 300);
  return "Unbekannter Fehler bei Meta";
}

function parseError(status: number, json: unknown): MetaApiError {
  const e = (json && typeof json === "object" && "error" in json ? (json as { error: unknown }).error : null) as
    | { message?: unknown; error_user_msg?: unknown; error_user_title?: unknown; code?: unknown; error_subcode?: unknown; is_transient?: unknown }
    | null;
  const user = typeof e?.error_user_msg === "string" && e.error_user_msg.trim() ? e.error_user_msg.trim() : null;
  const raw = typeof e?.message === "string" ? e.message : `Meta-Fehler ${status}`;
  // Meta-Meldungen enthalten keine Tokens; zur Sicherheit trotzdem nichts Token-Ähnliches durchlassen.
  const message = (user ?? raw).replace(/EAA[A-Za-z0-9]{20,}/g, "…").slice(0, 300);
  return new MetaApiError(message, {
    status,
    code: typeof e?.code === "number" ? e.code : null,
    subcode: typeof e?.error_subcode === "number" ? e.error_subcode : null,
    transient: e?.is_transient === true,
  });
}

// ---------------------------------------------------------------------------
// Graph-Client

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type Params = Record<string, string | number | boolean | null | undefined>;

export interface GraphClient {
  readonly version: string;
  get<T = Record<string, unknown>>(path: string, params: Params, token: string | null): Promise<T>;
  post<T = Record<string, unknown>>(path: string, params: Params, token: string): Promise<T>;
}

export function graphClient(cfg: MetaConfig, fetchImpl: FetchLike = fetch, timeoutMs = 25_000): GraphClient {
  const base = `https://graph.facebook.com/${cfg.graphVersion}`;
  function withAuth(params: Params, token: string | null): URLSearchParams {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) q.set(k, String(v));
    if (token) {
      q.set("access_token", token);
      q.set("appsecret_proof", appSecretProof(token, cfg.appSecret));
    }
    return q;
  }
  async function call<T>(method: "GET" | "POST", path: string, params: Params, token: string | null): Promise<T> {
    if (!/^\/[A-Za-z0-9_./-]*$/.test(path) || path.includes("..")) throw new Error("Ungültiger Graph-Pfad");
    const q = withAuth(params, token);
    const init: RequestInit = { method, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" };
    let url = `${base}${path}`;
    if (method === "GET") url += `?${q.toString()}`;
    else {
      init.body = q;
      init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
    }
    const res = await fetchImpl(url, init);
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok || (json && typeof json === "object" && "error" in json)) throw parseError(res.status, json);
    return (json ?? {}) as T;
  }
  return {
    version: cfg.graphVersion,
    get: (path, params, token) => call("GET", path, params, token),
    post: (path, params, token) => call("POST", path, params, token),
  };
}

// ---------------------------------------------------------------------------
// Anmelden

/** Code aus dem Rücksprung gegen ein langlebiges Nutzer-Token tauschen (ca. 60 Tage). */
export async function exchangeCodeForUserToken(client: GraphClient, cfg: MetaConfig, code: string, redirectUri: string): Promise<string> {
  const short = await client.get<{ access_token?: string }>(
    "/oauth/access_token",
    { client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: redirectUri, code },
    null,
  );
  if (!short.access_token) throw new MetaApiError("Meta hat kein Token geliefert", { status: 502 });
  const long = await client.get<{ access_token?: string }>(
    "/oauth/access_token",
    { grant_type: "fb_exchange_token", client_id: cfg.appId, client_secret: cfg.appSecret, fb_exchange_token: short.access_token },
    null,
  );
  return long.access_token || short.access_token;
}

export async function grantedScopes(client: GraphClient, userToken: string): Promise<string[]> {
  const r = await client.get<{ data?: { permission?: string; status?: string }[] }>("/me/permissions", {}, userToken);
  return (r.data ?? []).filter((p) => p.status === "granted" && typeof p.permission === "string").map((p) => p.permission as string);
}

export interface MetaPage {
  id: string;
  name: string;
  /** Seiten-Token; nur auf dem Server verwenden. */
  token: string;
  igUserId: string | null;
  igUsername: string | null;
}

export async function listPages(client: GraphClient, userToken: string): Promise<MetaPage[]> {
  const r = await client.get<{
    data?: { id?: string; name?: string; access_token?: string; instagram_business_account?: { id?: string; username?: string } }[];
  }>("/me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username}", limit: 100 }, userToken);
  return (r.data ?? [])
    .filter((p) => p.id && p.access_token)
    .map((p) => ({
      id: String(p.id),
      name: p.name?.trim() || `Seite ${p.id}`,
      token: String(p.access_token),
      igUserId: p.instagram_business_account?.id ? String(p.instagram_business_account.id) : null,
      igUsername: p.instagram_business_account?.username ?? null,
    }));
}

// ---------------------------------------------------------------------------
// Posten

export interface MetaTarget {
  pageId: string;
  pageToken: string;
  igUserId: string | null;
}

export type PublishResult =
  | { state: "PUBLISHED"; externalId: string; postUrl: string | null }
  | { state: "PROCESSING"; containerId: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stand eines Instagram-Containers. */
async function containerStatus(client: GraphClient, containerId: string, token: string): Promise<string> {
  const r = await client.get<{ status_code?: string; status?: string }>(`/${containerId}`, { fields: "status_code,status" }, token);
  const code = (r.status_code ?? "").toUpperCase();
  if (code === "ERROR" || code === "EXPIRED") {
    throw new MetaApiError(`Instagram konnte die Datei nicht verarbeiten${r.status ? ` (${String(r.status).slice(0, 120)})` : ""}`, { status: 422 });
  }
  return code;
}

async function igCreateContainer(client: GraphClient, post: PublishablePost, caption: string, target: MetaTarget): Promise<string> {
  const ig = target.igUserId as string;
  const token = target.pageToken;
  const one = post.media[0];
  const mediaParams = (url: string): Params => (isVideoUrl(url) ? { media_type: "VIDEO", video_url: url } : { image_url: url });
  let params: Params;
  if (post.format === "STORY") {
    params = isVideoUrl(one) ? { media_type: "STORIES", video_url: one } : { media_type: "STORIES", image_url: one };
  } else if (post.format === "REEL" || (post.media.length === 1 && isVideoUrl(one))) {
    params = { media_type: "REELS", video_url: one, caption, share_to_feed: true };
  } else if (post.media.length > 1) {
    const children: string[] = [];
    for (const url of post.media) {
      const child = await client.post<{ id?: string }>(`/${ig}/media`, { ...mediaParams(url), is_carousel_item: true }, token);
      if (!child.id) throw new MetaApiError("Instagram hat kein Karussell-Bild angenommen", { status: 502 });
      children.push(child.id);
    }
    params = { media_type: "CAROUSEL", children: children.join(","), caption };
  } else {
    params = { image_url: one, caption };
  }
  const c = await client.post<{ id?: string }>(`/${ig}/media`, params, token);
  if (!c.id) throw new MetaApiError("Instagram hat keinen Container geliefert", { status: 502 });
  return c.id;
}

async function igPublish(
  client: GraphClient,
  post: PublishablePost,
  caption: string,
  target: MetaTarget,
  opts: { waitMs: number },
): Promise<PublishResult> {
  const ig = target.igUserId as string;
  const token = target.pageToken;
  const containerId = post.containerId ?? (await igCreateContainer(client, post, caption, target));
  // Bilder sind meist sofort fertig, Videos brauchen Minuten: dann übernimmt der Cron.
  let status = await containerStatus(client, containerId, token);
  for (let waited = 0; status !== "FINISHED" && status !== "PUBLISHED" && waited < opts.waitMs; waited += 2000) {
    await sleep(2000);
    status = await containerStatus(client, containerId, token);
  }
  if (status !== "FINISHED" && status !== "PUBLISHED") return { state: "PROCESSING", containerId };
  const pub = await client.post<{ id?: string }>(`/${ig}/media_publish`, { creation_id: containerId }, token);
  if (!pub.id) throw new MetaApiError("Instagram hat den Beitrag nicht veröffentlicht", { status: 502 });
  let postUrl: string | null = null;
  try {
    const m = await client.get<{ permalink?: string }>(`/${pub.id}`, { fields: "permalink" }, token);
    postUrl = typeof m.permalink === "string" && m.permalink.startsWith("https://") ? m.permalink : null;
  } catch {
    // Link ist nett, aber nicht nötig.
  }
  return { state: "PUBLISHED", externalId: pub.id, postUrl };
}

function fbPermalink(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  if (raw.startsWith("https://")) return raw;
  if (raw.startsWith("/")) return `https://www.facebook.com${raw}`;
  return null;
}

async function fbPublish(client: GraphClient, post: PublishablePost, caption: string, target: MetaTarget): Promise<PublishResult> {
  const page = target.pageId;
  const token = target.pageToken;
  let externalId: string;
  if (post.media.length === 1 && isVideoUrl(post.media[0])) {
    const v = await client.post<{ id?: string }>(`/${page}/videos`, { file_url: post.media[0], description: caption }, token);
    if (!v.id) throw new MetaApiError("Facebook hat das Video nicht angenommen", { status: 502 });
    externalId = v.id;
  } else if (post.media.length === 1) {
    const p = await client.post<{ id?: string; post_id?: string }>(`/${page}/photos`, { url: post.media[0], message: caption }, token);
    if (!p.post_id && !p.id) throw new MetaApiError("Facebook hat das Bild nicht angenommen", { status: 502 });
    externalId = (p.post_id ?? p.id) as string;
  } else if (post.media.length > 1) {
    const params: Params = { message: caption };
    for (const [i, url] of post.media.entries()) {
      const p = await client.post<{ id?: string }>(`/${page}/photos`, { url, published: false }, token);
      if (!p.id) throw new MetaApiError("Facebook hat ein Bild nicht angenommen", { status: 502 });
      params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: p.id });
    }
    const f = await client.post<{ id?: string }>(`/${page}/feed`, params, token);
    if (!f.id) throw new MetaApiError("Facebook hat den Beitrag nicht veröffentlicht", { status: 502 });
    externalId = f.id;
  } else {
    const f = await client.post<{ id?: string }>(`/${page}/feed`, { message: caption, link: post.link ?? undefined }, token);
    if (!f.id) throw new MetaApiError("Facebook hat den Beitrag nicht veröffentlicht", { status: 502 });
    externalId = f.id;
  }
  let postUrl: string | null = null;
  try {
    const m = await client.get<{ permalink_url?: string }>(`/${externalId}`, { fields: "permalink_url" }, token);
    postUrl = fbPermalink(m.permalink_url);
  } catch {
    // ohne Link weiter
  }
  return { state: "PUBLISHED", externalId, postUrl };
}

/**
 * Beitrag veröffentlichen. Instagram-Videos liefern zuerst PROCESSING mit
 * Container-ID; der nächste Aufruf mit dieser ID veröffentlicht, sobald Meta fertig ist.
 */
export async function publishToMeta(
  client: GraphClient,
  target: MetaTarget,
  post: PublishablePost,
  hashtags: string | null,
  opts: { waitMs?: number } = {},
): Promise<PublishResult> {
  const caption = metaCaption(post, hashtags);
  // Länge und Hashtags samt der Hashtags der Kampagne prüfen.
  const problem = publishProblem({ ...post, text: caption }, target);
  if (problem) throw new MetaApiError(problem, { status: 400 });
  if (post.channel === "INSTAGRAM") return igPublish(client, post, post.format === "STORY" ? "" : caption, target, { waitMs: opts.waitMs ?? 8000 });
  return fbPublish(client, post, caption, target);
}

// ---------------------------------------------------------------------------
// Zahlen

export interface MetaStats {
  reach: number | null;
  interactions: number | null;
  views: number | null;
  clicks: number | null;
  postUrl: string | null;
}

/** Wert aus einer Insights-Antwort (values[0].value oder total_value.value). */
export function insightValues(json: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const data = json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data) ? (json as { data: unknown[] }).data : [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const r = row as { name?: unknown; values?: { value?: unknown }[]; total_value?: { value?: unknown } };
    if (typeof r.name !== "string") continue;
    const v = r.total_value?.value ?? r.values?.at(-1)?.value;
    if (typeof v === "number" && Number.isFinite(v)) out[r.name] = Math.max(0, Math.round(v));
  }
  return out;
}

async function tryGet(client: GraphClient, path: string, params: Params, token: string): Promise<unknown> {
  try {
    return await client.get(path, params, token);
  } catch (err) {
    if (err instanceof MetaApiError && (err.tokenInvalid || err.transient)) throw err;
    return null;
  }
}

export async function fetchMetaStats(
  client: GraphClient,
  target: MetaTarget,
  post: { channel: SocialChannel; format: SocialFormat; externalId: string },
): Promise<MetaStats> {
  const token = target.pageToken;
  const id = post.externalId;
  if (post.channel === "INSTAGRAM") {
    const metrics = post.format === "STORY" ? "reach,views,total_interactions,link_clicks" : "reach,views,total_interactions";
    const ins = insightValues(await tryGet(client, `/${id}/insights`, { metric: metrics }, token));
    const media = (await tryGet(client, `/${id}`, { fields: "permalink,like_count,comments_count" }, token)) as
      | { permalink?: string; like_count?: number; comments_count?: number }
      | null;
    const fallback = media && (typeof media.like_count === "number" || typeof media.comments_count === "number")
      ? (media.like_count ?? 0) + (media.comments_count ?? 0)
      : null;
    return {
      reach: ins.reach ?? null,
      views: ins.views ?? null,
      interactions: ins.total_interactions ?? fallback,
      clicks: ins.link_clicks ?? null,
      postUrl: typeof media?.permalink === "string" && media.permalink.startsWith("https://") ? media.permalink : null,
    };
  }
  const obj = (await tryGet(
    client,
    `/${id}`,
    { fields: "permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)" },
    token,
  )) as { permalink_url?: string; shares?: { count?: number }; reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } } | null;
  const parts = [obj?.reactions?.summary?.total_count, obj?.comments?.summary?.total_count, obj?.shares?.count].filter((n): n is number => typeof n === "number");
  const reach = insightValues(await tryGet(client, `/${id}/insights`, { metric: "post_impressions_unique" }, token));
  const clicks = insightValues(await tryGet(client, `/${id}/insights`, { metric: "post_clicks" }, token));
  return {
    reach: reach.post_impressions_unique ?? null,
    views: null,
    interactions: parts.length ? parts.reduce((a, b) => a + b, 0) : null,
    clicks: clicks.post_clicks ?? null,
    postUrl: fbPermalink(obj?.permalink_url),
  };
}
