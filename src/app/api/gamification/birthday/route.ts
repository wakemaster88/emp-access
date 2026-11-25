import { after, NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { birthdaySchema, normalizeBirthday } from "@/lib/gamification-input";
import { runAccountAnnouncements } from "@/lib/rider-announce";

/** Laufzeitlimit der Route auf Vercel in Sekunden (gleicher Wert wie in vercel.json). */
export const maxDuration = 60;

/** PUT: Geburtstag in der Kunden-App einstellen (Gruß, Geschenk, Push). Gilt jedes Jahr. */
export async function PUT(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = birthdaySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  }
  const data = normalizeBirthday(parsed.data);
  const saved = await db.riderBirthday.upsert({
    where: { accountId },
    create: { ...data, accountId },
    update: data,
  });
  // Hat heute jemand Geburtstag, geht der Push gleich raus (sonst im 5-Minuten-Cron).
  if (data.pushPlanned && data.active) {
    after(() => runAccountAnnouncements(accountId).catch((e) => console.error("[announce]", e)));
  }
  return NextResponse.json(saved);
}
