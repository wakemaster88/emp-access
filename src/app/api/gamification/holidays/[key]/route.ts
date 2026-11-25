import { after, NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { holidaySchema, normalizeHoliday } from "@/lib/gamification-input";
import { skillRewardAllowed } from "@/lib/rider-skills";
import { HOLIDAY_BY_KEY } from "@/lib/holidays";
import { runAccountAnnouncements } from "@/lib/rider-announce";

/** Laufzeitlimit der Route auf Vercel in Sekunden (gleicher Wert wie in vercel.json). */
export const maxDuration = 60;

/** PUT: Einstellung eines Feiertags speichern (anlegen oder ändern). Gilt jedes Jahr. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  const { key } = await params;
  if (!HOLIDAY_BY_KEY.has(key)) return NextResponse.json({ error: "Unbekannter Feiertag" }, { status: 404 });

  const parsed = holidaySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  }
  if (!(await skillRewardAllowed(db, accountId, parsed.data.skillId))) {
    return NextResponse.json({ error: "Unbekannter Skill" }, { status: 400 });
  }
  const data = normalizeHoliday(parsed.data);
  const holiday = await db.riderHoliday.upsert({
    where: { accountId_key: { accountId, key } },
    create: { ...data, key, accountId },
    update: data,
  });
  // Liegt der Feiertag schon im Zeitraum, geht ein geplanter Push gleich raus (sonst im 5-Minuten-Cron).
  if (holiday.pushPlanned && holiday.active) {
    after(() => runAccountAnnouncements(accountId).catch((e) => console.error("[announce]", e)));
  }
  return NextResponse.json(holiday);
}
