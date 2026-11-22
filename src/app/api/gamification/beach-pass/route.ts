import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gamiAdminSession } from "@/lib/gamification-session";
import { backfillYear, invalidateGamiConfig } from "@/lib/gamification-service";
import { cleanIds, foreignRefError } from "@/lib/tenant-refs";
import { berlinYmd } from "@/lib/berlin-day";
import { ensureBeachAwards } from "@/lib/beach-awards";

const schema = z.object({
  enabled: z.boolean(),
  subscriptionIds: z.array(z.number().int()).max(100),
});

/**
 * PUT: Beach Pass ein- oder ausschalten und die Strandbad-Abos wählen.
 * Danach werden die Tagessummen des laufenden Jahres neu berechnet, damit
 * die Strandbad-Besuche der Saison sofort mitzählen (bzw. wieder wegfallen).
 * Beim Einschalten wird die Beach-Award-Vorlage angelegt (fehlende Schlüssel).
 */
export async function PUT(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  const beachSubscriptionIds = cleanIds(parsed.data.subscriptionIds);
  const refError = await foreignRefError(db, accountId, { subscriptionIds: beachSubscriptionIds });
  if (refError) return NextResponse.json({ error: refError }, { status: 400 });

  const before = await db.gamificationConfig.findUnique({
    where: { accountId },
    select: { beachEnabled: true, beachSubscriptionIds: true, subscriptionIds: true },
  });
  const overlap = beachSubscriptionIds.filter((id) => before?.subscriptionIds.includes(id));
  if (overlap.length > 0) {
    return NextResponse.json(
      { error: "Dieses Abo zählt schon für den Ride Pass. Bitte nur Abos ohne Lift wählen." },
      { status: 400 },
    );
  }
  if (parsed.data.enabled && beachSubscriptionIds.length === 0) {
    return NextResponse.json({ error: "Bitte mindestens ein Strandbad-Abo wählen." }, { status: 400 });
  }

  const data = { beachEnabled: parsed.data.enabled, beachSubscriptionIds };
  await db.gamificationConfig.upsert({ where: { accountId }, create: { ...data, accountId }, update: data });
  invalidateGamiConfig(accountId);

  const changed =
    (before?.beachEnabled ?? false) !== data.beachEnabled ||
    (data.beachEnabled && [...(before?.beachSubscriptionIds ?? [])].sort().join(",") !== [...beachSubscriptionIds].sort().join(","));
  const awardsCreated = data.beachEnabled && !(before?.beachEnabled ?? false) ? await ensureBeachAwards(db, accountId) : 0;
  let recount: { year: number; days: number; tickets: number } | null = null;
  if (changed) {
    const year = Number(berlinYmd(new Date()).slice(0, 4));
    const r = await backfillYear(db, accountId, year);
    recount = { year, days: r.days, tickets: r.tickets };
  }
  return NextResponse.json({ ok: true, ...data, recount, awardsCreated });
}
