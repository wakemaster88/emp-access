import { z } from "zod";
import { POLL_OPTIONS_MAX, POLL_OPTIONS_MIN } from "./gamification";
import { MAX_SKILL_COOLDOWN, MAX_SKILL_MINUTES, MAX_SKILL_USES, normalizeSkillReward } from "./rider-skill-rules";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Skill als Belohnung; ältere Aufrufer lassen die Felder weg (bleibt, wie es ist). */
const skillReward = {
  skillId: z.number().int().positive().nullable().optional(),
  skillUses: z.number().int().min(1).max(MAX_SKILL_USES).nullable().optional(),
  skillValidDays: z.number().int().min(1).max(730).nullable().optional(),
};

/** Eingabe für das Anlegen und Ändern eines Meilensteins (Awards). */
export const milestoneSchema = z.object({
  name: z.string().trim().min(1).max(60),
  metric: z.enum([
    "VISIT_DAYS", "STARTS", "STREAK_WEEKS", "EARLY_DAYS", "WEEKENDS", "EVENT_DAYS", "OPENING_DAY", "COLD_DAYS", "SEASONS",
  ]),
  threshold: z.number().int().min(1).max(10_000),
  period: z.enum(["SEASON", "MONTH", "ALL_TIME"]),
  voucherLabel: z.string().trim().max(80).nullable(),
  voucherValidDays: z.number().int().min(1).max(730).nullable(),
  // Ab hier neu mit den Awards; ältere Aufrufer lassen die Felder weg.
  voucherShort: z.string().trim().max(24).nullable().optional(),
  bonus: z.string().trim().max(80).nullable().optional(),
  tier: z.enum(["BRONZE", "SILVER", "GOLD", "LEGENDARY"]).optional(),
  hint: z.string().trim().max(160).nullable().optional(),
  eventDays: z.array(ymd).max(60).optional(),
  /** Grenze der Wassertemperatur in °C (Zählart „Tage mit kaltem Wasser“). */
  tempBelow: z.number().min(-5).max(40).nullable().optional(),
  ...skillReward,
  active: z.boolean(),
  /** Für welchen Pass (Ride Pass, Beach Pass, beide); fehlt der Wert, bleibt er, wie er ist. */
  audience: z.enum(["RIDE", "BEACH", "ALL"]).optional(),
}).refine((m) => m.metric !== "COLD_DAYS" || m.tempBelow != null, { message: "Die Grenze der Wassertemperatur fehlt" });

export type MilestoneInput = z.infer<typeof milestoneSchema>;

const blank = (v: string | null | undefined) => (v && v.length > 0 ? v : null);

/**
 * Für die Datenbank aufbereiten: leere Leistung heißt Meilenstein ohne
 * Gutschein, Saisons zählen immer über alle Jahre, der erste Tag der Saison
 * ist genau ein Tag. Eingetragene Tage gibt es nur bei den Zählarten
 * „Aktionstage“ und „Erster Tag der Saison“ (dort ersetzen sie den
 * automatisch ermittelten Tag), die Grad-Grenze nur bei „Tage mit kaltem
 * Wasser“. Nicht übergebene Award-Felder bleiben, wie sie sind.
 */
export function normalizeMilestone(input: MilestoneInput) {
  const voucherLabel = blank(input.voucherLabel);
  return {
    name: input.name,
    metric: input.metric,
    threshold: input.metric === "OPENING_DAY" ? 1 : input.threshold,
    period: input.metric === "SEASONS" ? ("ALL_TIME" as const) : input.period,
    voucherLabel,
    voucherValidDays: voucherLabel ? input.voucherValidDays : null,
    ...(input.voucherShort !== undefined && { voucherShort: voucherLabel ? blank(input.voucherShort) : null }),
    ...(input.bonus !== undefined && { bonus: blank(input.bonus) }),
    ...(input.tier !== undefined && { tier: input.tier }),
    ...(input.hint !== undefined && { hint: blank(input.hint) }),
    ...(input.eventDays !== undefined && {
      eventDays:
        input.metric === "EVENT_DAYS" || input.metric === "OPENING_DAY"
          ? [...new Set(input.eventDays)].sort().map((d) => new Date(`${d}T00:00:00.000Z`))
          : [],
    }),
    tempBelow: input.metric === "COLD_DAYS" ? input.tempBelow ?? null : null,
    ...normalizeSkillReward(input),
    active: input.active,
    ...(input.audience !== undefined && { audience: input.audience }),
  };
}

/** Eingabe für das Anlegen und Ändern einer Challenge. */
export const challengeSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300).nullable(),
    kind: z.enum(["TASK", "TOP_X", "PHOTO", "POLL"]),
    metric: z.enum(["VISIT_DAYS", "STARTS", "STREAK_WEEKS"]),
    threshold: z.number().int().min(1).max(10_000).nullable(),
    topCount: z.number().int().min(1).max(100).nullable(),
    startDate: ymd,
    endDate: ymd,
    /** Uhrzeit am Endtag ("HH:MM"); null = bis Mitternacht. */
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
    voucherLabel: z.string().trim().max(80).nullable(),
    voucherValidDays: z.number().int().min(1).max(730).nullable(),
    ...skillReward,
    active: z.boolean(),
    /** Abstimmung: die Antworten in der gezeigten Reihenfolge. */
    options: z.array(z.string().trim().max(60)).max(POLL_OPTIONS_MAX + 4).optional(),
    /** Push an die Kunden-App senden; fehlt der Wert, bleibt der Plan, wie er ist. */
    push: z.boolean().optional(),
    /** Für welchen Pass (Ride Pass, Beach Pass, beide); fehlt der Wert, bleibt er, wie er ist. */
    audience: z.enum(["RIDE", "BEACH", "ALL"]).optional(),
  })
  .refine((c) => c.startDate <= c.endDate, { message: "Das Ende liegt vor dem Start" })
  .refine((c) => (c.kind === "TASK" ? c.threshold != null : c.kind === "POLL" || c.topCount != null), {
    message: "Schwelle oder Anzahl der Gewinner fehlt",
  })
  .refine((c) => c.kind !== "POLL" || pollOptions(c.options).length >= POLL_OPTIONS_MIN, {
    message: `Eine Abstimmung braucht mindestens ${POLL_OPTIONS_MIN} Antworten`,
  })
  .refine((c) => c.kind !== "POLL" || pollOptions(c.options).length <= POLL_OPTIONS_MAX, {
    message: `Höchstens ${POLL_OPTIONS_MAX} Antworten`,
  });

export type ChallengeInput = z.infer<typeof challengeSchema>;

/** Antworten einer Abstimmung: leere weg, doppelte (ohne Groß/klein) nur einmal. */
export function pollOptions(raw: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of raw ?? []) {
    const label = o.replace(/\s+/g, " ").trim();
    const key = label.toLocaleLowerCase("de");
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/** Nur die zur Art passenden Werte behalten; leere Leistung heißt ohne Gutschein. */
export function normalizeChallenge(input: ChallengeInput) {
  // Eine Abstimmung vergibt nichts.
  const voucherLabel = input.kind !== "POLL" && input.voucherLabel && input.voucherLabel.length > 0 ? input.voucherLabel : null;
  return {
    name: input.name,
    description: input.description && input.description.length > 0 ? input.description : null,
    kind: input.kind,
    // Foto und Abstimmung zählen keine Starts; die Spalte braucht trotzdem einen Wert.
    metric: input.kind === "TASK" || input.kind === "TOP_X" ? input.metric : ("VISIT_DAYS" as const),
    threshold: input.kind === "TASK" ? input.threshold : null,
    topCount: input.kind === "TOP_X" || input.kind === "PHOTO" ? input.topCount : null,
    startDate: new Date(`${input.startDate}T00:00:00.000Z`),
    endDate: new Date(`${input.endDate}T00:00:00.000Z`),
    endTime: input.endTime ?? null,
    voucherLabel,
    voucherValidDays: voucherLabel ? input.voucherValidDays : null,
    ...(input.kind === "POLL" ? { skillId: null, skillUses: 1, skillValidDays: null } : normalizeSkillReward(input)),
    active: input.active,
    ...(input.audience !== undefined && { audience: input.audience }),
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
    /** Push an die Kunden-App senden; fehlt der Wert, bleibt der Plan, wie er ist. */
    push: z.boolean().optional(),
    /** Für welchen Pass (Ride Pass, Beach Pass, beide); fehlt der Wert, bleibt er, wie er ist. */
    audience: z.enum(["RIDE", "BEACH", "ALL"]).optional(),
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
    ...(input.audience !== undefined && { audience: input.audience }),
  };
}

/**
 * Push-Plan beim Speichern: nur ändern, wenn der Schalter mitkommt und noch
 * nichts gesendet ist. Ein gesendeter Push lässt sich nicht zurückholen.
 */
export function pushPlanPatch(push: boolean | undefined, pushedAt: Date | null): { pushPlanned?: boolean } {
  if (push === undefined || pushedAt) return {};
  return { pushPlanned: push };
}

/** Eingabe für einen Feiertag der Kunden-App (`key` steht im Pfad). */
export const holidaySchema = z
  .object({
    show: z.enum(["GREETING", "OFFER", "VOUCHER"]),
    title: z.string().trim().max(60).nullable(),
    text: z.string().trim().max(300).nullable(),
    voucherLabel: z.string().trim().max(80).nullable(),
    voucherValidDays: z.number().int().min(1).max(730).nullable(),
    daysBefore: z.number().int().min(0).max(14),
    ...skillReward,
    active: z.boolean(),
    /** Push am Feiertag; fehlt der Wert, bleibt der Plan, wie er ist. */
    push: z.boolean().optional(),
  })
  .refine((h) => h.show !== "OFFER" || !!h.text, { message: "Beim Angebot fehlt der Text" })
  .refine((h) => h.show !== "VOUCHER" || !!h.voucherLabel || !!h.skillId, {
    message: "Beim Gutschein fehlt die Leistung oder der Skill",
  });

export type HolidayInput = z.infer<typeof holidaySchema>;

/** Leere Felder als NULL; Leistung und Gültigkeit gibt es nur beim Gutschein. */
export function normalizeHoliday(input: HolidayInput) {
  const voucher = input.show === "VOUCHER";
  return {
    show: input.show,
    title: blank(input.title),
    text: blank(input.text),
    voucherLabel: voucher ? blank(input.voucherLabel) : null,
    voucherValidDays: voucher ? input.voucherValidDays : null,
    ...(voucher ? normalizeSkillReward(input) : { skillId: null, skillUses: 1, skillValidDays: null }),
    daysBefore: input.daysBefore,
    active: input.active,
    ...(input.push !== undefined && { pushPlanned: input.push }),
  };
}

/** Eingabe für einen Skill der Kunden-App (Gerät schalten oder Musik-Joker). */
export const skillSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    description: z.string().trim().max(160).nullable(),
    kind: z.enum(["DEVICE", "MUSIC"]),
    deviceId: z.number().int().positive().nullable(),
    minutes: z.number().int().min(1).max(MAX_SKILL_MINUTES),
    cooldownMinutes: z.number().int().min(0).max(MAX_SKILL_COOLDOWN),
    onlyOperating: z.boolean(),
    onlyOnSite: z.boolean(),
    paused: z.boolean(),
    active: z.boolean(),
  })
  .refine((s) => s.kind !== "DEVICE" || s.deviceId != null, { message: "Bitte ein Gerät wählen" });

export type SkillInput = z.infer<typeof skillSchema>;

export function normalizeSkill(input: SkillInput) {
  return {
    name: input.name,
    description: blank(input.description),
    kind: input.kind,
    deviceId: input.kind === "DEVICE" ? input.deviceId : null,
    minutes: input.minutes,
    cooldownMinutes: input.cooldownMinutes,
    onlyOperating: input.onlyOperating,
    onlyOnSite: input.onlyOnSite,
    paused: input.paused,
    active: input.active,
  };
}

/** Geburtstag in der Kunden-App (Kunden App › Aktionen): Gruß, Geschenk, Push. */
export const birthdaySchema = z.object({
  active: z.boolean(),
  title: z.string().trim().max(60).nullable(),
  text: z.string().trim().max(300).nullable(),
  /** Leistung auf dem Geschenk-Gutschein; null = nur der Gruß. */
  voucherLabel: z.string().trim().max(80).nullable(),
  voucherValidDays: z.number().int().min(1).max(730).nullable(),
  push: z.boolean(),
});

export function normalizeBirthday(input: z.infer<typeof birthdaySchema>) {
  const voucherLabel = blank(input.voucherLabel);
  return {
    active: input.active,
    title: blank(input.title),
    text: blank(input.text),
    voucherLabel,
    voucherValidDays: voucherLabel ? input.voucherValidDays : null,
    pushPlanned: input.push,
  };
}

/** Geburtstags-Durchsage am Start-Drehkreuz (Audio › Zeitpläne). */
export const birthdayAnnounceSchema = z
  .object({
    announceActive: z.boolean(),
    announceText: z.string().trim().max(300).nullable(),
    announceName: z.boolean(),
    announceZoneIds: z.array(z.number().int().positive()).max(50),
    announceVoice: z.string().trim().max(60).nullable(),
    announceChime: z.boolean(),
  })
  .refine((a) => !a.announceActive || a.announceZoneIds.length > 0, { message: "Bitte mindestens eine Zone wählen" });

export function normalizeBirthdayAnnounce(input: z.infer<typeof birthdayAnnounceSchema>) {
  return {
    ...input,
    announceText: blank(input.announceText),
    announceVoice: blank(input.announceVoice),
    announceZoneIds: [...new Set(input.announceZoneIds)],
  };
}
