import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gamiAdminSession } from "@/lib/gamification-session";
import { normalizeThresholds } from "@/lib/rider-occupancy";

const schema = z.object({
  mediumFrom: z.number().int().min(2).max(500),
  highFrom: z.number().int().min(3).max(500),
});

/** PUT: Grenzen der Auslastung am Lift (Kunden-App und Verwaltung) speichern. */
export async function PUT(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte ganze Zahlen ab 2 eingeben." }, { status: 400 });
  }
  if (parsed.data.highFrom <= parsed.data.mediumFrom) {
    return NextResponse.json({ error: "„Viel los“ muss größer sein als „Gut besucht“." }, { status: 400 });
  }
  const t = normalizeThresholds(parsed.data);
  const data = { occupancyMediumFrom: t.mediumFrom, occupancyHighFrom: t.highFrom };
  await db.gamificationConfig.upsert({
    where: { accountId },
    create: { ...data, accountId },
    update: data,
  });
  return NextResponse.json({ ok: true, thresholds: t });
}
