/**
 * Regeln des Moduls Social Media ohne Datenbank: Kanäle, Formate, Zustände,
 * Prüfen der Eingaben, Zeitraum einer Kampagne. Darf in Client-Bausteine
 * (lädt kein prisma).
 */
import { berlinHm, berlinYmd, isBerlinYmd } from "@/lib/berlin-day";

export const SOCIAL_CHANNELS = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE", "WHATSAPP", "GOOGLE", "OTHER"] as const;
export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];

export const CHANNEL_LABEL: Record<SocialChannel, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  WHATSAPP: "WhatsApp-Kanal",
  GOOGLE: "Google-Profil",
  OTHER: "Sonstiges",
};

/** utm_source je Kanal. */
export const CHANNEL_SOURCE: Record<SocialChannel, string> = {
  INSTAGRAM: "instagram",
  FACEBOOK: "facebook",
  TIKTOK: "tiktok",
  YOUTUBE: "youtube",
  WHATSAPP: "whatsapp",
  GOOGLE: "google",
  OTHER: "social",
};

/** Höchstlänge des Textes, wie der Kanal sie annimmt (Stand 2026). */
export const CHANNEL_TEXT_LIMIT: Record<SocialChannel, number> = {
  INSTAGRAM: 2200,
  FACEBOOK: 5000,
  TIKTOK: 4000,
  YOUTUBE: 5000,
  WHATSAPP: 4000,
  GOOGLE: 1500,
  OTHER: 5000,
};

export const SOCIAL_FORMATS = ["POST", "STORY", "REEL", "CAROUSEL"] as const;
export type SocialFormat = (typeof SOCIAL_FORMATS)[number];

export const FORMAT_LABEL: Record<SocialFormat, string> = {
  POST: "Beitrag",
  STORY: "Story",
  REEL: "Reel / Video",
  CAROUSEL: "Karussell",
};

export const POST_STATUSES = ["IDEA", "DRAFT", "READY", "PUBLISHED"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  IDEA: "Idee",
  DRAFT: "In Arbeit",
  READY: "Fertig",
  PUBLISHED: "Veröffentlicht",
};

export type CampaignPhase = "OPEN" | "PLANNED" | "RUNNING" | "DONE";

export const PHASE_LABEL: Record<CampaignPhase, string> = {
  OPEN: "Ohne Zeitraum",
  PLANNED: "Geplant",
  RUNNING: "Läuft",
  DONE: "Vorbei",
};

const MAX_MEDIA = 10;
const MAX_URL = 2000;

export function isChannel(v: unknown): v is SocialChannel {
  return typeof v === "string" && (SOCIAL_CHANNELS as readonly string[]).includes(v);
}
export function isFormat(v: unknown): v is SocialFormat {
  return typeof v === "string" && (SOCIAL_FORMATS as readonly string[]).includes(v);
}
export function isPostStatus(v: unknown): v is PostStatus {
  return typeof v === "string" && (POST_STATUSES as readonly string[]).includes(v);
}

export function isHttpsUrl(value: string): boolean {
  if (value.length > MAX_URL) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !!u.hostname;
  } catch {
    return false;
  }
}

/** Kalendertag einer @db.Date-Spalte als "YYYY-MM-DD" (Prisma liefert UTC-Mitternacht). */
export function dateOnly(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Zeitraum einer Kampagne gegenüber dem heutigen Berlin-Kalendertag. */
export function campaignPhase(startsOn: string | null, endsOn: string | null, today: string): CampaignPhase {
  if (!startsOn && !endsOn) return "OPEN";
  if (endsOn && today > endsOn) return "DONE";
  if (startsOn && today < startsOn) return "PLANNED";
  return "RUNNING";
}

/** „6.12.2026“ bzw. „6.12. – 31.12.2026“ für die Liste. */
export function periodLabel(startsOn: string | null, endsOn: string | null): string | null {
  const fmt = (ymd: string, withYear: boolean) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return withYear ? `${d}.${m}.${y}` : `${d}.${m}.`;
  };
  if (startsOn && endsOn) {
    if (startsOn === endsOn) return fmt(startsOn, true);
    const sameYear = startsOn.slice(0, 4) === endsOn.slice(0, 4);
    return `${fmt(startsOn, !sameYear)} – ${fmt(endsOn, true)}`;
  }
  if (startsOn) return `ab ${fmt(startsOn, true)}`;
  if (endsOn) return `bis ${fmt(endsOn, true)}`;
  return null;
}

/** Kürzel aus dem Namen: „Nikolausfahren 2026“ → "nikolausfahren-2026". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Ein Termin aus dem Feld datetime-local ("YYYY-MM-DDTHH:mm") als Berlin-Zeit. */
export function berlinLocalToDate(value: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m || !isBerlinYmd(m[1])) return null;
  const [, ymd, hh, mm] = m;
  if (Number(hh) > 23 || Number(mm) > 59) return null;
  for (const offset of ["+01:00", "+02:00"]) {
    const d = new Date(`${ymd}T${hh}:${mm}:00${offset}`);
    if (!Number.isNaN(d.getTime()) && berlinYmd(d) === ymd && berlinHm(d) === `${hh}:${mm}`) return d;
  }
  // Uhr wird vorgestellt (die Stunde gibt es nicht): eine Stunde später.
  const d = new Date(`${ymd}T${hh}:${mm}:00+01:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Wert für ein Feld datetime-local in Berlin-Zeit. */
export function toBerlinLocalInput(d: Date | null | undefined): string {
  return d ? `${berlinYmd(d)}T${berlinHm(d)}` : "";
}

/** Geplant, Termin vorbei, nicht veröffentlicht. */
export function isOverdue(post: { status: string; plannedAt: Date | null }, now: Date = new Date()): boolean {
  return post.status !== "PUBLISHED" && !!post.plannedAt && post.plannedAt.getTime() < now.getTime();
}

/** Text zum Kopieren: Beitragstext und die Hashtags der Kampagne, falls sie fehlen. */
export function postCopyText(text: string, hashtags: string | null): string {
  const body = text.trim();
  const tags = (hashtags ?? "").trim();
  if (!tags) return body;
  const missing = tags.split(/\s+/).filter((t) => t && !body.toLowerCase().includes(t.toLowerCase()));
  if (missing.length === 0) return body;
  return body ? `${body}\n\n${missing.join(" ")}` : missing.join(" ");
}

// ---------------------------------------------------------------------------
// Eingaben prüfen
// ---------------------------------------------------------------------------

function text(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > max ? null : t;
}

function ymdOrNull(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  return typeof v === "string" && isBerlinYmd(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? v : "invalid";
}

function countOrNull(v: unknown): number | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[.\s]/g, "")) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 1_000_000_000 ? n : "invalid";
}

export interface CampaignInput {
  name: string;
  slug: string;
  description: string | null;
  startsOn: string | null;
  endsOn: string | null;
  landingUrl: string | null;
  hashtags: string | null;
}

export function parseCampaignInput(body: Record<string, unknown> | null): CampaignInput | { error: string } {
  if (!body) return { error: "Ungültige Anfrage" };
  const name = text(body.name, 120);
  if (!name) return { error: name === null ? "Name: höchstens 120 Zeichen" : "Name fehlt" };
  const rawSlug = text(body.slug, 60);
  if (rawSlug === null) return { error: "Kürzel: höchstens 60 Zeichen" };
  const slug = rawSlug ? rawSlug.toLowerCase() : slugify(name);
  if (!slug || !SLUG_RE.test(slug)) return { error: "Kürzel: nur Kleinbuchstaben, Ziffern und Bindestriche" };
  const description = text(body.description, 5000);
  if (description === null) return { error: "Beschreibung: höchstens 5000 Zeichen" };
  const startsOn = ymdOrNull(body.startsOn);
  const endsOn = ymdOrNull(body.endsOn);
  if (startsOn === "invalid" || endsOn === "invalid") return { error: "Ungültiges Datum" };
  if (startsOn && endsOn && endsOn < startsOn) return { error: "Das Ende liegt vor dem Beginn" };
  const landingUrl = text(body.landingUrl, MAX_URL);
  if (landingUrl === null || (landingUrl && !isHttpsUrl(landingUrl))) return { error: "Ziel-Link: bitte eine https-Adresse" };
  const hashtags = text(body.hashtags, 500);
  if (hashtags === null) return { error: "Hashtags: höchstens 500 Zeichen" };
  return {
    name,
    slug,
    description: description || null,
    startsOn,
    endsOn,
    landingUrl: landingUrl || null,
    hashtags: hashtags ? normalizeHashtags(hashtags) : null,
  };
}

/** „wakeboard, #tuttenbrocksee“ → "#wakeboard #tuttenbrocksee". */
export function normalizeHashtags(raw: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const tag = part.replace(/^#+/, "").trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`#${tag}`);
  }
  return out.join(" ");
}

export interface PostInput {
  channel: SocialChannel;
  format: SocialFormat;
  status: PostStatus;
  text: string;
  media: string[];
  link: string | null;
  plannedAt: Date | null;
  postUrl: string | null;
  reach: number | null;
  interactions: number | null;
  clicks: number | null;
  notes: string | null;
  /** Zum Termin automatisch über Meta posten (nur Instagram/Facebook, Stand „Fertig“, mit Termin). */
  autoPublish: boolean;
}

export function parsePostInput(body: Record<string, unknown> | null): PostInput | { error: string } {
  if (!body) return { error: "Ungültige Anfrage" };
  if (!isChannel(body.channel)) return { error: "Bitte einen Kanal wählen" };
  const format = body.format === undefined ? "POST" : body.format;
  if (!isFormat(format)) return { error: "Ungültiges Format" };
  const status = body.status === undefined ? "IDEA" : body.status;
  if (!isPostStatus(status)) return { error: "Ungültiger Zustand" };
  const t = text(body.text, CHANNEL_TEXT_LIMIT[body.channel]);
  if (t === null) return { error: `Text: höchstens ${CHANNEL_TEXT_LIMIT[body.channel]} Zeichen für ${CHANNEL_LABEL[body.channel]}` };
  const rawMedia = body.media ?? [];
  if (!Array.isArray(rawMedia)) return { error: "Ungültige Bilder" };
  const media = rawMedia.map((m) => (typeof m === "string" ? m.trim() : "")).filter(Boolean);
  if (media.length > MAX_MEDIA) return { error: `Höchstens ${MAX_MEDIA} Bilder oder Videos` };
  if (media.some((m) => !isHttpsUrl(m))) return { error: "Bilder: bitte nur https-Adressen" };
  const link = text(body.link, MAX_URL);
  if (link === null || (link && !isHttpsUrl(link))) return { error: "Link: bitte eine https-Adresse" };
  let plannedAt: Date | null = null;
  if (typeof body.plannedAt === "string" && body.plannedAt) {
    plannedAt = berlinLocalToDate(body.plannedAt);
    if (!plannedAt) return { error: "Ungültiger Termin" };
  } else if (body.plannedAt !== undefined && body.plannedAt !== null && body.plannedAt !== "") {
    return { error: "Ungültiger Termin" };
  }
  const postUrl = text(body.postUrl, MAX_URL);
  if (postUrl === null || (postUrl && !isHttpsUrl(postUrl))) return { error: "Link zum Beitrag: bitte eine https-Adresse" };
  const reach = countOrNull(body.reach);
  const interactions = countOrNull(body.interactions);
  const clicks = countOrNull(body.clicks);
  if (reach === "invalid" || interactions === "invalid" || clicks === "invalid") return { error: "Zahlen: bitte ganze Zahlen ab 0" };
  const notes = text(body.notes, 2000);
  if (notes === null) return { error: "Notiz: höchstens 2000 Zeichen" };
  const autoPublish = body.autoPublish === true;
  if (autoPublish) {
    if (body.channel !== "INSTAGRAM" && body.channel !== "FACEBOOK") return { error: "Automatisch posten geht nur auf Instagram und Facebook" };
    if (status !== "READY") return { error: "Automatisch posten: Stand auf „Fertig“ stellen" };
    if (!plannedAt) return { error: "Automatisch posten: bitte einen Termin setzen" };
  }
  return {
    channel: body.channel,
    format,
    status,
    text: t,
    media,
    link: link || null,
    plannedAt,
    postUrl: postUrl || null,
    reach,
    interactions,
    clicks,
    notes: notes || null,
    autoPublish,
  };
}

/** Zeitpunkt der Veröffentlichung: beim Wechsel auf „Veröffentlicht“ jetzt (oder der Termin, wenn er vorbei ist). */
export function nextPublishedAt(
  previous: { status: string; publishedAt: Date | null } | null,
  input: { status: PostStatus; plannedAt: Date | null },
  now: Date = new Date(),
): Date | null {
  if (input.status !== "PUBLISHED") return null;
  if (previous?.status === "PUBLISHED" && previous.publishedAt) return previous.publishedAt;
  if (input.plannedAt && input.plannedAt.getTime() <= now.getTime()) return input.plannedAt;
  return now;
}
