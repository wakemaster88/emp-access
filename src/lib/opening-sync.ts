/**
 * Abgleich der Betriebszeiten mit anny und der Website, für das Statusfeld auf
 * /betriebszeiten. Liest nur: anny über die Verfügbarkeits-API mit dem Token
 * aus „Schnittstellen“, die Website über einen Nur-Lese-Zugang auf ihre
 * Datenbank (`WEBSITE_DATABASE_URL`, Rolle `emp_access_reader`).
 *
 * Die Website übernimmt seit 22.11.2026 die Zeiten aus emp-access
 * (`/api/public/betriebszeiten`). Ob sie das für eine Seite tut, fragt der
 * Abgleich die Live-Website (`/api/opening/<slug>/<heute>` mit `source`
 * „emp-access“). Nur Seiten, die das nicht tun, werden wie früher gelesen:
 * mit anny-Ressource die anny-Zeiten, solange in ihrer eigenen Tabelle für den
 * Tag nichts steht.
 */
import { neon } from "@neondatabase/serverless";
import { berlinOffset } from "./anny-availability";
import type { ScheduleSpec } from "./operating-hours";
import {
  annyDayValues,
  compareDays,
  dayMarks,
  daysBetween,
  matchWebsiteSlug,
  normalizeName,
  scheduleDayValue,
  websiteDayValue,
  type CompareResult,
  type DayValue,
  type WebsiteDateRow,
  type WebsitePeriodRow,
} from "./opening-compare";
import { addDaysToYmd, tzYmd } from "./tz-time";

/** So weit voraus wird verglichen. */
export const SYNC_DAYS = 365;

export type SyncState = "same" | "diff" | "empty" | "unlinked" | "error";

export interface SyncSide {
  state: SyncState;
  /** Woher die Zeiten kommen, z. B. „anny 179465“ oder „Website /gastro“. */
  source: string | null;
  /** Letzter Tag, für den die Quelle selbst Zeiten hat. */
  lastDay: string | null;
  /** Nur Website: Tage, an denen sie die anny-Zeiten zeigt. */
  fromAnny?: number;
  /** Nur Website: Seite übernimmt die Zeiten live aus emp-access. */
  viaEmp?: boolean;
  result: CompareResult | null;
  /** Ein Zeichen je Tag ab `from` für das Farbband (siehe `dayMarks`). */
  marks: string | null;
}

export interface SyncRow {
  scheduleId: number;
  name: string;
  /** Unterprofil von; Unterprofile stehen nicht auf der Website. */
  parentId: number | null;
  anny: SyncSide;
  website: SyncSide;
}

export interface SyncReport {
  checkedAt: string;
  /** Erster geprüfter Tag = heute; vergangene Tage zählen nicht. */
  from: string;
  to: string;
  /** Anzahl Tage von `from` bis `to`. */
  days: number;
  anny: { configured: boolean; error: string | null };
  website: { configured: boolean; error: string | null };
  rows: SyncRow[];
}

export interface SyncSchedule {
  id: number;
  name: string;
  spec: ScheduleSpec;
  parentId?: number | null;
  /** Fest eingetragene anny-Ressource; geht vor Website-Seite und Namen. */
  annyResourceId?: string | null;
}

export interface AnnyLinkInfo {
  annyResourceId: string;
  areaName: string;
  isPublic: boolean;
}

export interface WebsitePage {
  id: number;
  slug: string;
  annyResourceId: string | null;
}

export interface WebsiteData {
  pages: WebsitePage[];
  periods: Map<number, WebsitePeriodRow[]>;
  dates: Map<number, WebsiteDateRow[]>;
}

const LIFT_NAME = /wasserski|wakeboard|seilbahn|lift/i;

/** Öffentliche Adresse der Website (für die Prüfung, ob sie emp-access übernimmt). */
export const DEFAULT_WEBSITE_PUBLIC_URL = "https://www.tuttenbrocksee.com";

/**
 * Welche Seiten zeigen live die Zeiten aus emp-access? Fragt je Seite den
 * heutigen Tag ab. Fehler zählen als „nein“ – dann gilt der bisherige Abgleich.
 */
async function loadWebsiteLive(baseUrl: string, slugs: string[], today: string): Promise<Set<string>> {
  const base = baseUrl.replace(/\/+$/, "");
  const results = await Promise.all(
    slugs.map(async (slug) => {
      try {
        const res = await fetch(`${base}/api/opening/${encodeURIComponent(slug)}/${today}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8_000),
          cache: "no-store",
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { source?: unknown };
        return json?.source === "emp-access" ? slug : null;
      } catch {
        return null;
      }
    }),
  );
  return new Set(results.filter((s): s is string => s != null));
}

function side(state: SyncState, source: string | null = null): SyncSide {
  return { state, source, lastDay: null, result: null, marks: null };
}

async function loadWebsite(url: string, from: string, to: string): Promise<WebsiteData> {
  const sql = neon(url);
  const [pages, periods, dates] = await Promise.all([
    sql`SELECT id, slug, anny_resource_id FROM pages`,
    sql`SELECT page_id, valid_from::text AS valid_from, valid_to::text AS valid_to, js_day, time_text, is_closed, priority
        FROM opening_hours_periods WHERE valid_to >= ${from}::date AND valid_from <= ${to}::date`,
    sql`SELECT page_id, date::text AS date, time_text, is_closed
        FROM opening_hours_dates WHERE date BETWEEN ${from}::date AND ${to}::date`,
  ]);
  const byPage = <T>(rows: Record<string, unknown>[], map: (r: Record<string, unknown>) => T) => {
    const out = new Map<number, T[]>();
    for (const r of rows) {
      const id = Number(r.page_id);
      const list = out.get(id) ?? [];
      list.push(map(r));
      out.set(id, list);
    }
    return out;
  };
  return {
    pages: pages.map((p) => ({
      id: Number(p.id),
      slug: String(p.slug),
      annyResourceId: p.anny_resource_id ? String(p.anny_resource_id) : null,
    })),
    periods: byPage(periods, (r) => ({
      validFrom: String(r.valid_from),
      validTo: String(r.valid_to),
      jsDay: r.js_day == null ? null : Number(r.js_day),
      timeText: r.time_text == null ? null : String(r.time_text),
      isClosed: Boolean(r.is_closed),
      priority: Number(r.priority ?? 0),
    })),
    dates: byPage(dates, (r) => ({
      date: String(r.date),
      timeText: r.time_text == null ? null : String(r.time_text),
      isClosed: Boolean(r.is_closed),
    })),
  };
}

/** anny-Perioden je Ressource für einen Zeitraum (ganze Tage in Berlin). */
async function loadAnny(
  baseUrl: string,
  token: string,
  resourceIds: string[],
  from: string,
  to: string,
): Promise<Map<string, { start: string; end: string }[]>> {
  const params = new URLSearchParams({
    start_date: `${from}T00:00:00${berlinOffset(from)}`,
    end_date: `${to}T23:59:59${berlinOffset(to)}`,
    timezone: "Europe/Berlin",
  });
  for (const id of resourceIds) params.append("r[]", id);
  const res = await fetch(`${baseUrl}/api/v1/availability/periods?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`anny antwortet mit ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  const body = (json && typeof json === "object" && "data" in json && json.data && typeof json.data === "object"
    ? json.data
    : json) as Record<string, unknown>;
  const out = new Map<string, { start: string; end: string }[]>();
  for (const [rid, periods] of Object.entries(body)) {
    if (!Array.isArray(periods)) continue;
    out.set(
      rid,
      periods
        .map((p: Record<string, string>) => ({
          start: p.start || p.start_date || p.from || "",
          end: p.end || p.end_date || p.to || "",
        }))
        .filter((p) => p.start && p.end),
    );
  }
  return out;
}

/**
 * anny-Ressource eines Profils: fest eingetragen, sonst über die Website-Seite,
 * sonst über den Bereich gleichen Namens. Unterprofile nur fest eingetragen –
 * „Bahnmiete Seilbahn A“ ist nicht der öffentliche Lift.
 */
function annyResourceFor(
  schedule: SyncSchedule,
  page: WebsitePage | null,
  links: AnnyLinkInfo[],
): string | null {
  if (schedule.annyResourceId) return schedule.annyResourceId;
  if (schedule.parentId != null) return null;
  if (page?.annyResourceId) return page.annyResourceId;
  const name = normalizeName(schedule.name);
  const sameArea = [...new Set(links.filter((l) => normalizeName(l.areaName) === name).map((l) => l.annyResourceId))];
  if (sameArea.length === 1) return sameArea[0];
  if (LIFT_NAME.test(schedule.name)) {
    const pub = [...new Set(links.filter((l) => l.isPublic).map((l) => l.annyResourceId))];
    if (pub.length === 1) return pub[0];
  }
  return null;
}

function lastOf(days: string[], has: (ymd: string) => boolean): string | null {
  for (let i = days.length - 1; i >= 0; i -= 1) if (has(days[i])) return days[i];
  return null;
}

function finish(
  days: string[],
  ours: (ymd: string) => DayValue,
  theirs: (ymd: string) => DayValue | null,
  source: string,
  lastDay: string | null,
): SyncSide {
  const result = compareDays(days, ours, theirs);
  const state: SyncState = result.differing === 0 ? "same" : lastDay == null ? "empty" : "diff";
  return { state, source, lastDay, result, marks: dayMarks(days, ours, theirs, lastDay) };
}

export async function buildSyncReport(options: {
  schedules: SyncSchedule[];
  timezone: string;
  anny: { baseUrl: string; token: string } | null;
  links: AnnyLinkInfo[];
  websiteUrl: string | null;
  /** Öffentliche Website für die Live-Prüfung; null = nicht prüfen. */
  websitePublicUrl?: string | null;
  now?: Date;
  /** Nur für Tests und Vorschau: Laden ersetzen. */
  loaders?: {
    website?: (from: string, to: string) => Promise<WebsiteData>;
    anny?: (resourceIds: string[], from: string, to: string) => Promise<Map<string, { start: string; end: string }[]>>;
    websiteLive?: (slugs: string[], today: string) => Promise<Set<string>>;
  };
}): Promise<SyncReport> {
  const now = options.now ?? new Date();
  const from = tzYmd(now, options.timezone);
  const to = addDaysToYmd(from, SYNC_DAYS - 1);
  const days = daysBetween(from, to);

  let website: WebsiteData | null = null;
  let websiteError: string | null = null;
  if (options.websiteUrl) {
    try {
      website = options.loaders?.website
        ? await options.loaders.website(from, to)
        : await loadWebsite(options.websiteUrl, from, to);
    } catch (e) {
      websiteError = e instanceof Error ? e.message : "Website-Datenbank nicht erreichbar";
    }
  }

  const slugs = website?.pages.map((p) => p.slug) ?? [];
  const plan = options.schedules.map((s) => {
    const slug = website && s.parentId == null ? matchWebsiteSlug(s.name, slugs) : null;
    const page = slug ? (website?.pages.find((p) => p.slug === slug) ?? null) : null;
    return { schedule: s, page, resourceId: annyResourceFor(s, page, options.links) };
  });

  // Seiten, die live aus emp-access lesen, sind per Definition gleich.
  const linkedSlugs = [...new Set(plan.map((p) => p.page?.slug).filter((s): s is string => Boolean(s)))];
  const liveSlugs =
    website && linkedSlugs.length > 0 && (options.loaders?.websiteLive || options.websitePublicUrl)
      ? options.loaders?.websiteLive
        ? await options.loaders.websiteLive(linkedSlugs, from)
        : await loadWebsiteLive(options.websitePublicUrl as string, linkedSlugs, from)
      : new Set<string>();

  let annyPeriods: Map<string, { start: string; end: string }[]> | null = null;
  let annyError: string | null = null;
  const resourceIds = [
    ...new Set([
      ...plan.map((p) => p.resourceId),
      ...(website?.pages.map((p) => p.annyResourceId) ?? []),
    ].filter((id): id is string => Boolean(id))),
  ];
  if (options.anny && resourceIds.length > 0) {
    try {
      annyPeriods = options.loaders?.anny
        ? await options.loaders.anny(resourceIds, from, to)
        : await loadAnny(options.anny.baseUrl, options.anny.token, resourceIds, from, to);
    } catch (e) {
      annyError = e instanceof Error ? e.message : "anny nicht erreichbar";
    }
  }
  const annyValues = new Map<string, Map<string, DayValue>>();
  for (const [rid, periods] of annyPeriods ?? []) annyValues.set(rid, annyDayValues(periods, options.timezone));

  const rows: SyncRow[] = plan.map(({ schedule, page, resourceId }) => {
    const ourValues = new Map(days.map((d) => [d, scheduleDayValue(schedule.spec, d)]));
    const ours = (ymd: string) => ourValues.get(ymd) ?? scheduleDayValue(schedule.spec, ymd);

    let anny: SyncSide;
    if (!options.anny) anny = side("unlinked");
    else if (!resourceId) anny = side("unlinked");
    else if (annyError || !annyPeriods) anny = side("error", `anny ${resourceId}`);
    else {
      const values = annyValues.get(resourceId) ?? new Map<string, DayValue>();
      anny = finish(days, ours, (ymd) => values.get(ymd) ?? "zu", `anny ${resourceId}`, lastOf(days, (d) => values.has(d)));
    }

    let site: SyncSide;
    if (!options.websiteUrl) site = side("unlinked");
    else if (websiteError || !website) site = side("error");
    else if (!page) site = side("unlinked");
    else if (liveSlugs.has(page.slug)) {
      site = { ...finish(days, ours, ours, `Website /${page.slug} · aus emp-access`, to), fromAnny: 0, viaEmp: true };
    } else {
      const periods = website.periods.get(page.id) ?? [];
      const dates = website.dates.get(page.id) ?? [];
      const own = new Map(days.map((d) => [d, websiteDayValue(periods, dates, d)]));
      const viaAnny = page.annyResourceId ? annyValues.get(page.annyResourceId) : undefined;
      // Ohne eigenen Eintrag zeigt die Website die anny-Zeiten der verknüpften Ressource.
      const theirs = (ymd: string): DayValue | null => own.get(ymd) ?? (viaAnny ? (viaAnny.get(ymd) ?? "zu") : null);
      const fromAnny = viaAnny ? days.filter((d) => own.get(d) == null).length : 0;
      const lastOwn = lastOf(days, (d) => own.get(d) != null);
      const lastAnny = viaAnny ? lastOf(days, (d) => viaAnny.has(d)) : null;
      const lastDay = [lastOwn, lastAnny].filter((d): d is string => d != null).sort().at(-1) ?? null;
      // Seite ohne eigene Zeiten und ohne anny (z. B. /shop = Ticketshop): Der Bereich
      // steht nicht mit Öffnungszeiten auf der Website – wie „nicht in anny“.
      site =
        lastDay == null
          ? side("unlinked")
          : { ...finish(days, ours, theirs, `Website /${page.slug}`, lastDay), fromAnny };
    }

    return { scheduleId: schedule.id, name: schedule.name, parentId: schedule.parentId ?? null, anny, website: site };
  });

  return {
    checkedAt: now.toISOString(),
    from,
    to,
    days: days.length,
    anny: { configured: Boolean(options.anny), error: annyError },
    website: { configured: Boolean(options.websiteUrl), error: websiteError },
    rows,
  };
}
