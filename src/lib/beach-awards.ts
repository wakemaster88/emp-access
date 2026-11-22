/**
 * Beach-Award-Vorlage anlegen (Liste `BEACH_AWARD_DEFAULTS` in awards.ts).
 * Läuft beim Einschalten des Beach Pass; ein schon vorhandener Schlüssel
 * bleibt unberührt, auch wenn er geändert oder ausgeschaltet wurde.
 */
import type { TenantDb } from "@/lib/prisma";
import { BEACH_AWARD_DEFAULTS, BEACH_AWARD_SORT_BASE } from "@/lib/awards";

export async function ensureBeachAwards(db: TenantDb, accountId: number): Promise<number> {
  const r = await db.milestone.createMany({
    data: BEACH_AWARD_DEFAULTS.map((a, i) => ({
      accountId,
      key: a.key,
      name: a.name,
      tier: a.tier,
      metric: a.metric,
      threshold: a.threshold,
      period: a.period,
      voucherLabel: a.voucherLabel,
      voucherShort: a.voucherShort,
      voucherValidDays: a.voucherValidDays,
      bonus: a.bonus ?? null,
      hint: a.hint ?? null,
      tempBelow: a.tempBelow ?? null,
      audience: "BEACH" as const,
      sortOrder: BEACH_AWARD_SORT_BASE + i + 1,
    })),
    skipDuplicates: true,
  });
  return r.count;
}
