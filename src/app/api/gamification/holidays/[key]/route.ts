import { NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { holidaySchema, normalizeHoliday } from "@/lib/gamification-input";
import { HOLIDAY_BY_KEY } from "@/lib/holidays";

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
  const data = normalizeHoliday(parsed.data);
  const holiday = await db.riderHoliday.upsert({
    where: { accountId_key: { accountId, key } },
    create: { ...data, key, accountId },
    update: data,
  });
  return NextResponse.json(holiday);
}
