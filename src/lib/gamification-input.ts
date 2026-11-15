import { z } from "zod";

/** Eingabe für das Anlegen und Ändern eines Meilensteins. */
export const milestoneSchema = z.object({
  name: z.string().trim().min(1).max(60),
  metric: z.enum(["VISIT_DAYS", "STARTS", "STREAK_WEEKS"]),
  threshold: z.number().int().min(1).max(10_000),
  period: z.enum(["SEASON", "MONTH"]),
  voucherLabel: z.string().trim().max(80).nullable(),
  voucherValidDays: z.number().int().min(1).max(730).nullable(),
  active: z.boolean(),
});

export type MilestoneInput = z.infer<typeof milestoneSchema>;

/** Leere Leistung heißt: Meilenstein ohne Gutschein. */
export function normalizeMilestone(input: MilestoneInput): MilestoneInput {
  const voucherLabel = input.voucherLabel && input.voucherLabel.length > 0 ? input.voucherLabel : null;
  return { ...input, voucherLabel, voucherValidDays: voucherLabel ? input.voucherValidDays : null };
}
