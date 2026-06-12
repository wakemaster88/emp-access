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
  email: z.string().email().max(180).optional().nullable(),
});

export const ticketUpdateSchema = ticketCreateSchema.partial();

// ─── Mitarbeiter-Schemas ─────────────────────────────────────────────────────

const hhmmOptional = z.union([
  z.literal(""),
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format HH:MM"),
]);

const daySchedule = z.object({
  enabled: z.boolean().default(false),
  on: hhmmOptional.default(""),
  off: hhmmOptional.default(""),
});

export const weekScheduleSchema = z.object({
  mon: daySchedule,
  tue: daySchedule,
  wed: daySchedule,
  thu: daySchedule,
  fri: daySchedule,
  sat: daySchedule,
  sun: daySchedule,
});

/**
 * Update-Schema fuer Mitarbeiter (gespeichert als Ticket mit source=EMP_CONTROL).
 * Vorhandene Ticket-Felder kombiniert mit Direkt-Geraete-Whitelist und
 * Wochenplan.
 */
export const employeeUpdateSchema = z.object({
  name: z.string().min(1).max(180).optional(),
  firstName: z.string().max(120).nullable().optional(),
  lastName: z.string().max(120).nullable().optional(),
  rfidCode: z.string().max(120).nullable().optional(),
  email: z.union([z.literal(""), z.string().email().max(180)]).nullable().optional(),
  ticketTypeName: z.string().max(120).nullable().optional(),
  startDate: z.union([z.literal(""), z.string()]).nullable().optional(),
  endDate: z.union([z.literal(""), z.string()]).nullable().optional(),
  status: z.enum(["VALID", "INVALID", "PROTECTED"]).optional(),
  profileImage: z.string().nullable().optional(),
  /// IDs der zugewiesenen Bereiche (Vollersetzung).
  areaIds: z.array(z.coerce.number().int().positive()).optional(),
  /// IDs der direkt zugewiesenen Geraete (Vollersetzung).
  deviceIds: z.array(z.coerce.number().int().positive()).optional(),
  /// Wochenplan (null = entfernen, ansonsten kompletter Plan).
  weekSchedule: weekScheduleSchema.nullable().optional(),
});

/// Anlage eines Mitarbeiters von Hand (sonst per EMP_CONTROL-Webhook).
export const employeeCreateSchema = employeeUpdateSchema.extend({
  name: z.string().min(1).max(180),
});

export const ticketBulkCreateSchema = z
  .object({
    /** Bei RFID-Bulks ergibt sich `count` aus `rfidCodes.length`; sonst Pflicht. */
    count: z.coerce.number().int().min(1).max(100).optional(),
    /** Namens-Praefix (z. B. "Tagesgast" → "Tagesgast 1", "Tagesgast 2", ...). */
    namePrefix: z.string().min(1).max(60).optional(),
    /** Optional: explizite Liste (Laenge muss `count` entsprechen, sonst Praefix). */
    names: z.array(z.string().min(1).max(120)).optional(),
    /**
     * RFID-Bulk-Modus: pro Code wird genau ein Ticket angelegt, der Code
     * wird in `rfidCode` gespeichert. Es wird kein Barcode/QR generiert
     * (die Tickets werden nicht gedruckt). Ticket-Name wird zu
     * `${namePrefix} ${rfidCode}` (z. B. "Bändchen ABC123").
     */
    rfidCodes: z.array(z.string().min(1).max(120)).min(1).max(100).optional(),
    ticketTypeName: z.string().max(120).optional().nullable(),
    accessAreaId: z.coerce.number().int().optional().nullable(),
    subscriptionId: z.coerce.number().int().optional().nullable(),
    serviceId: z.coerce.number().int().optional().nullable(),
    validityType: z.enum(["DATE_RANGE", "TIME_SLOT", "DURATION"]).optional(),
    startDate: z.string().datetime().optional().nullable(),
    endDate: z.string().datetime().optional().nullable(),
    slotStart: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
    slotEnd: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
    validityDurationMinutes: z.coerce.number().int().min(1).optional().nullable(),
    /** Optionales Praefix fuer den auto-generierten Barcode (Default "BLK"). */
    codePrefix: z.string().min(1).max(8).regex(/^[A-Z0-9-]+$/i).optional(),
  })
  .refine((v) => v.rfidCodes != null || v.count != null, {
    message: "count oder rfidCodes erforderlich",
    path: ["count"],
  });

export const deviceCreateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["RASPBERRY_PI", "SHELLY", "NUKI_SMARTLOCK"]),
  ipAddress: z.string().optional(),
  shellyId: z.string().optional(),
  shellyAuthKey: z.string().optional(),
  nukiSmartlockId: z.string().optional(),
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

/// Plausibles Vermietungsjahr (vermeidet Tippfehler wie "20226" oder "1990").
const lockerYear = z.coerce.number().int().min(2000).max(2100);
const lockerType = z.enum(["KEY", "PADLOCK"]);
/// Anzahl Schlüssel/Schlösser – realistisch 0–20.
const keyCount = z.coerce.number().int().min(0).max(20);
/// ISO-Datum/-Datetime (akzeptiert "2026-04-19" und volle ISO).
const isoDateTime = z
  .string()
  .min(1)
  .refine((s) => !isNaN(new Date(s).getTime()), "Ungültiges Datum");

export const lockerCreateSchema = z.object({
  name: z.string().min(1).max(120),
  number: z.string().min(1).max(40),
  location: z.string().max(120).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  lockType: lockerType.optional(),
  keyCount: keyCount.optional(),
  lockNumber: z.string().max(60).nullable().optional(),
  /// Optionales Bootstrap: bei Anlage direkt eine Vermietung für ein Jahr setzen.
  /// Mindestens eines von `ticketId` oder `renterName` muss gesetzt sein.
  initialRental: z
    .object({
      year: lockerYear,
      ticketId: z.coerce.number().int().positive().nullable().optional(),
      renterName: z.string().min(1).max(180).nullable().optional(),
      notes: z.string().max(500).nullable().optional(),
    })
    .refine(
      (v) => (v.ticketId != null) || !!v.renterName?.trim(),
      { message: "Entweder ein Mieter-Ticket oder ein manueller Name muss angegeben werden." },
    )
    .optional(),
});

export const lockerUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  number: z.string().min(1).max(40).optional(),
  location: z.string().max(120).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  lockType: lockerType.optional(),
  keyCount: keyCount.optional(),
  lockNumber: z.string().max(60).nullable().optional(),
});

/// Locker-Vermietung: entweder Abo-Ticket ODER manueller Mietername (mind. eins).
export const lockerRentalCreateSchema = z
  .object({
    year: lockerYear,
    ticketId: z.coerce.number().int().positive().nullable().optional(),
    renterName: z.string().min(1).max(180).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    keysIssued: keyCount.optional(),
    keysReturned: keyCount.optional(),
    issuedAt: isoDateTime.nullable().optional(),
    returnedAt: isoDateTime.nullable().optional(),
  })
  .refine(
    (v) => (v.ticketId != null) || !!v.renterName?.trim(),
    { message: "Entweder ein Mieter-Ticket oder ein manueller Name muss angegeben werden." },
  );

/// Update: ticketId und renterName koennen explizit auf null gesetzt werden,
/// um den Modus zu wechseln. Wenn beide explizit geschickt werden, muss am
/// Ende mindestens eines einen Wert haben (Pruefung im Handler).
export const lockerRentalUpdateSchema = z.object({
  year: lockerYear.optional(),
  ticketId: z.coerce.number().int().positive().nullable().optional(),
  renterName: z.string().max(180).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  keysIssued: keyCount.optional(),
  keysReturned: keyCount.optional(),
  issuedAt: isoDateTime.nullable().optional(),
  returnedAt: isoDateTime.nullable().optional(),
});

// ─── Fundsachen (LostItem) Schemas ───────────────────────────────────────────

/// ISO-Datum/-Datetime für das Funddatum (akzeptiert "2026-06-12" und volle ISO).
const lostItemDate = z
  .string()
  .min(1)
  .refine((s) => !isNaN(new Date(s).getTime()), "Ungültiges Datum");

/// Bild als Base64-Data-URL (gleiches Muster wie Ticket.profileImage).
/// ~2 MB Limit, damit keine riesigen Originalfotos in der DB landen.
const lostItemImage = z
  .string()
  .max(2_000_000, "Bild zu groß (max. ~1,5 MB)")
  .refine((s) => s.startsWith("data:image/"), "Ungültiges Bildformat");

export const lostItemCreateSchema = z.object({
  description: z.string().min(1).max(500),
  foundDate: lostItemDate,
  image: lostItemImage.nullable().optional(),
  contact: z.string().max(300).nullable().optional(),
  pickedUp: z.boolean().optional(),
});

export const lostItemUpdateSchema = lostItemCreateSchema.partial();

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

// ─── Email-Automation Schemas ────────────────────────────────────────────────

export const emailConfigUpdateSchema = z.object({
  provider: z.enum(["GMAIL"]).optional(),
  apiKey: z.string().min(1).max(200).nullable().optional(),
  fromEmail: z.string().email().max(180),
  fromName: z.string().max(120).nullable().optional(),
  replyTo: z.string().email().max(180).nullable().optional(),
  isActive: z.boolean().optional(),
  brandColor: z
    .string()
    .regex(/^#?[0-9a-fA-F]{3,8}$/i, "Ungültiger Farbcode")
    .nullable()
    .optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  websiteUrl: z.string().url().max(500).nullable().optional(),
});

const emailRuleTrigger = z.enum([
  "SUBSCRIPTION_EXPIRING",
  "SUBSCRIPTION_EXPIRED",
  "DAY_VISIT_FOLLOWUP",
  "TICKET_WELCOME",
]);

export const emailRuleCreateSchema = z.object({
  name: z.string().min(1).max(120),
  trigger: emailRuleTrigger,
  daysOffset: z.coerce.number().int().min(0).max(365),
  subscriptionId: z.coerce.number().int().positive().nullable().optional(),
  serviceId: z.coerce.number().int().positive().nullable().optional(),
  subject: z.string().min(1).max(240),
  bodyHtml: z.string().min(1).max(20000),
  createVoucher: z.boolean().optional(),
  voucherDiscountPercent: z.coerce.number().int().min(1).max(100).nullable().optional(),
  voucherValidDays: z.coerce.number().int().min(1).max(730).nullable().optional(),
  voucherTicketTypeName: z.string().max(120).nullable().optional(),
  renewUrl: z.string().url().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
  cooldownDays: z.coerce.number().int().min(0).max(365).optional(),
  lookbackDays: z.coerce.number().int().min(0).max(365).optional(),
});

export const emailRuleUpdateSchema = emailRuleCreateSchema.partial();

export const emailTestSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(240).optional(),
});

/**
 * Validiert eine Test-Versand-Anfrage für eine konkrete Regel (gespeichert
 * oder noch im Editor). Wir akzeptieren die kompletten Render-Inputs, damit
 * der Editor auch unsaved changes testen kann.
 */
export const emailRuleTestSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(240),
  bodyHtml: z.string().min(1).max(20000),
  trigger: emailRuleTrigger.optional(),
  daysOffset: z.coerce.number().int().min(0).max(365).optional(),
  createVoucher: z.boolean().optional(),
  voucherDiscountPercent: z.coerce.number().int().min(1).max(100).nullable().optional(),
  voucherValidDays: z.coerce.number().int().min(1).max(730).nullable().optional(),
  voucherTicketTypeName: z.string().max(120).nullable().optional(),
  renewUrl: z.string().url().max(500).nullable().optional(),
  ruleId: z.coerce.number().int().positive().optional(),
});

export const shellyAutomationUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  groupId: z.coerce.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  trigger: z.enum(["SCHEDULE", "SUNRISE", "SUNSET"]).optional(),
  daysOfWeek: z.coerce.number().int().min(0).max(127).optional(),
  timeOfDay: z.string().regex(hhmmRegex).nullable().optional(),
  offsetMinutes: z.coerce.number().int().min(-720).max(720).optional(),
});
