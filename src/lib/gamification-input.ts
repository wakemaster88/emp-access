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

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Eingabe für das Anlegen und Ändern einer Challenge. */
export const challengeSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300).nullable(),
    kind: z.enum(["TASK", "TOP_X"]),
    metric: z.enum(["VISIT_DAYS", "STARTS", "STREAK_WEEKS"]),
    threshold: z.number().int().min(1).max(10_000).nullable(),
    topCount: z.number().int().min(1).max(100).nullable(),
    startDate: ymd,
    endDate: ymd,
    voucherLabel: z.string().trim().max(80).nullable(),
    voucherValidDays: z.number().int().min(1).max(730).nullable(),
    active: z.boolean(),
  })
  .refine((c) => c.startDate <= c.endDate, { message: "Das Ende liegt vor dem Start" })
  .refine((c) => (c.kind === "TASK" ? c.threshold != null : c.topCount != null), {
    message: "Schwelle oder Anzahl der Gewinner fehlt",
  });

export type ChallengeInput = z.infer<typeof challengeSchema>;

/** Nur die zur Art passende Zahl behalten; leere Leistung heißt ohne Gutschein. */
export function normalizeChallenge(input: ChallengeInput) {
  const voucherLabel = input.voucherLabel && input.voucherLabel.length > 0 ? input.voucherLabel : null;
  return {
    name: input.name,
    description: input.description && input.description.length > 0 ? input.description : null,
    kind: input.kind,
    metric: input.metric,
    threshold: input.kind === "TASK" ? input.threshold : null,
    topCount: input.kind === "TOP_X" ? input.topCount : null,
    startDate: new Date(`${input.startDate}T00:00:00.000Z`),
    endDate: new Date(`${input.endDate}T00:00:00.000Z`),
    voucherLabel,
    voucherValidDays: voucherLabel ? input.voucherValidDays : null,
    active: input.active,
  };
}

/** Eingabe für ein Angebot der Kunden-App. */
export const offerSchema = z
  .object({
    title: z.string().trim().min(1).max(60),
    text: z.string().trim().max(300).nullable(),
    validFrom: ymd.nullable(),
    validTo: ymd.nullable(),
    active: z.boolean(),
  })
  .refine((o) => !o.validFrom || !o.validTo || o.validFrom <= o.validTo, { message: "Das Ende liegt vor dem Start" });

export type OfferInput = z.infer<typeof offerSchema>;

export function normalizeOffer(input: OfferInput) {
  return {
    title: input.title,
    text: input.text && input.text.length > 0 ? input.text : null,
    validFrom: input.validFrom ? new Date(`${input.validFrom}T00:00:00.000Z`) : null,
    validTo: input.validTo ? new Date(`${input.validTo}T00:00:00.000Z`) : null,
    active: input.active,
  };
}
