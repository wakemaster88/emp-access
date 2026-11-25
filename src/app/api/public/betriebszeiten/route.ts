import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scheduleSpecInclude, toScheduleSpec } from "@/lib/operating-queries";
import { clampPublicQuery, matchesArea, parsePublicQuery, publicArea } from "@/lib/public-opening";
import { DEFAULT_TIMEZONE, addDaysToYmd, tzYmd } from "@/lib/tz-time";
import { publicRateLimit, requestClientIp } from "@/lib/rate-limit";
import { createTtlCache } from "@/lib/ttl-cache";

/**
 * Öffentliche Betriebszeiten, ohne Anmeldung (für tuttenbrocksee.com).
 *
 *   GET /api/public/betriebszeiten                       heute + 13 Tage, alle Bereiche
 *   GET /api/public/betriebszeiten?tage=1&bereich=gastronomie
 *   GET /api/public/betriebszeiten?von=2027-04-01&bis=2027-04-30&bereich=wasserski,strandbad
 *
 * Gilt nur für den Mandanten der Website (`WEBSITE_ACCOUNT_ID`, Standard 1).
 * Liefert nur Bereichsnamen und Zeiten, nichts Internes. `von` wird auf ein
 * Fenster um heute gezogen (`clampPublicQuery` in lib/public-opening).
 */

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Anfragegrenze je IP. Die Website fragt von ihren eigenen Servern aus (wenige
 * gemeinsame Adressen) und hält die Antworten selbst 5 Minuten; dazu kommt der
 * CDN-Cache vor dieser Route. Die Grenze liegt weit über diesem Bedarf.
 */
const IP_LIMIT = { limit: 300, windowMs: 60_000 } as const;

/** Geladene Profile je Konto kurz im Speicher; die Tage werden je Abfrage berechnet. */
const SCHEDULES_TTL_MS = 60_000;
const loadSchedules = (accountId: number) =>
  prisma.operatingSchedule.findMany({
    // Nur Bereiche; Unterprofile (Bahnmieten, Kurse) bucht man über anny.
    where: { accountId, parentId: null },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: scheduleSpecInclude,
  });
const schedulesCache = createTtlCache<Awaited<ReturnType<typeof loadSchedules>>>(SCHEDULES_TTL_MS, { maxEntries: 20 });

function websiteAccountId(): number {
  const id = Number(process.env.WEBSITE_ACCOUNT_ID || 1);
  return Number.isInteger(id) && id > 0 ? id : 1;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: NextRequest) {
  const limited = publicRateLimit(requestClientIp(request.headers), "public-betriebszeiten", IP_LIMIT);
  if (limited) {
    for (const [k, v] of Object.entries(CORS)) limited.headers.set(k, v);
    return limited;
  }

  const today = tzYmd(new Date(), DEFAULT_TIMEZONE);
  const parsed = parsePublicQuery(request.nextUrl.searchParams, today);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400, headers: CORS });
  }
  const query = clampPublicQuery(parsed, today);

  try {
    const accountId = websiteAccountId();
    const schedules = await schedulesCache.get(String(accountId), () => loadSchedules(accountId));

    const bereiche = schedules
      .filter((s) => matchesArea(s, query.areas))
      .map((s) => publicArea({ id: s.id, name: s.name, spec: toScheduleSpec(s) }, query.from, query.days));

    return NextResponse.json(
      {
        stand: new Date().toISOString(),
        zeitzone: DEFAULT_TIMEZONE,
        von: query.from,
        bis: addDaysToYmd(query.from, query.days - 1),
        bereiche,
      },
      {
        headers: {
          ...CORS,
          // 5 Minuten frisch, danach noch eine Stunde aus dem CDN, während neu geladen wird.
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    console.error("[public-betriebszeiten]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Betriebszeiten gerade nicht verfügbar" }, { status: 503, headers: CORS });
  }
}
