import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gamiAdminSession } from "@/lib/gamification-session";
import { normalizeThresholds } from "@/lib/rider-occupancy";
import { normalizeBeachSettings } from "@/lib/beach-occupancy";

const schema = z.object({
  /** Lift: Fahrer der letzten 60 Minuten. */
  mediumFrom: z.number().int().min(2).max(500).optional(),
  highFrom: z.number().int().min(3).max(500).optional(),
  /** Strandbad: geschätzte Gäste vor Ort. */
  beach: z
    .object({
      factor: z.number().min(1).max(20),
      mediumFrom: z.number().int().min(1).max(100_000),
      highFrom: z.number().int().min(2).max(100_000),
    })
    .optional(),
});

/** PUT: Grenzen der Auslastung (Lift und/oder Strandbad) speichern. Gilt für Kunden-App und Verwaltung. */
export async function PUT(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte gültige Zahlen eingeben." }, { status: 400 });
  }
  const { mediumFrom, highFrom, beach } = parsed.data;
  const hasLift = mediumFrom != null && highFrom != null;
  if (!hasLift && !beach) {
    return NextResponse.json({ error: "Nichts zu speichern." }, { status: 400 });
  }
  if ((hasLift && highFrom <= mediumFrom) || (beach && beach.highFrom <= beach.mediumFrom)) {
    return NextResponse.json({ error: "„Viel los“ muss größer sein als „Gut besucht“." }, { status: 400 });
  }
  const lift = hasLift ? normalizeThresholds({ mediumFrom, highFrom }) : null;
  const b = beach ? normalizeBeachSettings(beach) : null;
  const data = {
    ...(lift && { occupancyMediumFrom: lift.mediumFrom, occupancyHighFrom: lift.highFrom }),
    ...(b && { beachGuestFactor: b.factor, beachMediumFrom: b.mediumFrom, beachHighFrom: b.highFrom }),
  };
  await db.gamificationConfig.upsert({
    where: { accountId },
    create: { ...data, accountId },
    update: data,
  });
  return NextResponse.json({ ok: true, thresholds: lift, beach: b });
}
