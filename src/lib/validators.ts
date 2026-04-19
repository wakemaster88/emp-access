import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const gateCheckSchema = z.object({
  hardware: z.coerce.number().int(),
  id: z.string().min(1),
});

export const scanPostSchema = z.array(
  z.object({
    sca_code: z.string(),
    sca_location: z.coerce.number().int(),
    sca_scan_time: z.coerce.number().int(),
    sca_grant: z.coerce.number().int(),
  })
);

export const piStatusSchema = z.array(
  z.object({
    pis_id: z.coerce.number().int(),
    pis_task: z.coerce.number().int(),
    pis_update: z.coerce.number().int(),
    system_info: z.record(z.string(), z.unknown()).optional(),
  })
);

export const ticketCreateSchema = z.object({
  name: z.string().min(1),
  qrCode: z.string().optional().nullable(),
  rfidCode: z.string().optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  validityType: z.enum(["DATE_RANGE", "TIME_SLOT", "DURATION"]).optional(),
  slotStart: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  slotEnd: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  validityDurationMinutes: z.coerce.number().int().min(1).optional().nullable(),
  accessAreaId: z.coerce.number().int().optional().nullable(),
  subscriptionId: z.coerce.number().int().optional().nullable(),
  serviceId: z.coerce.number().int().optional().nullable(),
  vereinId: z.coerce.number().int().optional().nullable(),
  status: z.enum(["VALID", "REDEEMED", "INVALID", "PROTECTED"]).optional(),
  barcode: z.string().optional().nullable(),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  ticketTypeName: z.string().optional().nullable(),
  profileImage: z.string().optional().nullable(),
});

export const ticketUpdateSchema = ticketCreateSchema.partial();

export const deviceCreateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["RASPBERRY_PI", "SHELLY"]),
  ipAddress: z.string().optional(),
  shellyId: z.string().optional(),
  shellyAuthKey: z.string().optional(),
  accessIn: z.coerce.number().int().optional(),
  accessOut: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const deviceUpdateSchema = deviceCreateSchema.partial();

export const shellyControlSchema = z.object({
  deviceId: z.coerce.number().int(),
  action: z.enum(["on", "off", "toggle"]),
  timer: z.coerce.number().int().optional(),
});

export const areaCreateSchema = z.object({
  name: z.string().min(1),
  parentId: z.coerce.number().int().optional(),
  allowReentry: z.boolean().optional(),
  personLimit: z.coerce.number().int().optional(),
});

export const areaUpdateSchema = areaCreateSchema.partial();

export const accountCreateSchema = z.object({
  subdomain: z.string().min(1).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  isActive: z.boolean().optional(),
});

export const accountUpdateSchema = accountCreateSchema.partial().extend({
  /** Leer = unverändert; sonst min. 16 Zeichen (Mandanten-API-Token) */
  apiToken: z.union([z.literal(""), z.string().min(16).max(256)]).optional(),
});

export const adminCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(["USER", "ADMIN"]).optional(),
});

export const adminUpdateSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  name: z.string().min(1).optional(),
  role: z.enum(["USER", "ADMIN"]).optional(),
});

// ─── Verein-Schemas ──────────────────────────────────────────────────────────

export const vereinCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  // IDs der Tickets, deren Areas die Mitglieder beim Scan erben (z. B.
  // „Bahnmiete“). Restriktionen kommen direkt vom Ticket (Datumsrange,
  // TIME_SLOT, DURATION).
  accessTicketIds: z.array(z.coerce.number().int().positive()).optional(),
  memberTicketIds: z.array(z.coerce.number().int().positive()).optional(),
});

export const vereinUpdateSchema = vereinCreateSchema.partial();

// ─── Locker (Schließfach) Schemas ────────────────────────────────────────────

export const lockerCreateSchema = z.object({
  name: z.string().min(1).max(120),
  number: z.string().min(1).max(40),
  location: z.string().max(120).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  /// ID eines Abo-Tickets (Mieter). NULL = freies Schließfach.
  ticketId: z.coerce.number().int().positive().nullable().optional(),
});

export const lockerUpdateSchema = lockerCreateSchema.partial();

// ─── Shelly-Automation Schemas ───────────────────────────────────────────────

const hhmmRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const shellyGroupMemberSchema = z.object({
  deviceId: z.coerce.number().int().positive(),
  action: z.enum(["ON", "OFF", "TOGGLE"]),
  timerSeconds: z.coerce.number().int().min(1).max(86400).nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

export const shellyGroupCreateSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
  members: z.array(shellyGroupMemberSchema).default([]),
});

export const shellyGroupUpdateSchema = shellyGroupCreateSchema.partial();

export const shellyAutomationCreateSchema = z
  .object({
    name: z.string().min(1).max(80),
    groupId: z.coerce.number().int().positive(),
    isActive: z.boolean().optional(),
    trigger: z.enum(["SCHEDULE", "SUNRISE", "SUNSET"]),
    daysOfWeek: z.coerce.number().int().min(0).max(127).optional(),
    timeOfDay: z
      .string()
      .regex(hhmmRegex, "Format HH:mm")
      .nullable()
      .optional(),
    offsetMinutes: z.coerce.number().int().min(-720).max(720).optional(),
  })
  .refine(
    (v) => v.trigger !== "SCHEDULE" || (typeof v.timeOfDay === "string" && hhmmRegex.test(v.timeOfDay)),
    { message: "timeOfDay erforderlich bei Trigger=SCHEDULE", path: ["timeOfDay"] }
  );

export const shellyAutomationUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  groupId: z.coerce.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  trigger: z.enum(["SCHEDULE", "SUNRISE", "SUNSET"]).optional(),
  daysOfWeek: z.coerce.number().int().min(0).max(127).optional(),
  timeOfDay: z.string().regex(hhmmRegex).nullable().optional(),
  offsetMinutes: z.coerce.number().int().min(-720).max(720).optional(),
});
