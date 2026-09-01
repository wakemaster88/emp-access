import { z } from "zod";
import { MAX_SCAN_LOCK_SECONDS } from "@/lib/scan-lock";

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
  type: z.enum(["RASPBERRY_PI", "SHELLY", "NUKI_SMARTLOCK", "LOQED_SMARTLOCK"]),
  ipAddress: z.string().optional(),
  shellyId: z.string().optional(),
  shellyAuthKey: z.string().optional(),
  nukiSmartlockId: z.string().optional(),
  loqedLockId: z.string().optional(),
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
  scanLockSeconds: z.coerce.number().int().min(0).max(MAX_SCAN_LOCK_SECONDS).nullable().optional(),
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

export const lostItemKindSchema = z.enum(["FOUND", "LOST_REPORT"]);

const lostItemBaseSchema = z.object({
  kind: lostItemKindSchema.optional(),
  description: z.string().min(1).max(500),
  foundDate: lostItemDate.optional(),
  image: lostItemImage.nullable().optional(),
  contact: z.string().max(300).nullable().optional(),
  reporterName: z.string().max(120).nullable().optional(),
  callbackPhone: z.string().max(40).nullable().optional(),
  pickedUp: z.boolean().optional(),
});

export const lostItemCreateSchema = lostItemBaseSchema.superRefine((data, ctx) => {
  const kind = data.kind === "LOST_REPORT" ? "LOST_REPORT" : "FOUND";
  if (kind === "LOST_REPORT") {
    if (!data.reporterName?.trim()) {
      ctx.addIssue({ code: "custom", path: ["reporterName"], message: "Name erforderlich" });
    }
  } else if (!data.foundDate) {
    ctx.addIssue({ code: "custom", path: ["foundDate"], message: "Funddatum erforderlich" });
  }
});

export const lostItemUpdateSchema = lostItemBaseSchema.partial().superRefine((data, ctx) => {
  if (data.kind !== "LOST_REPORT") return;
  if (data.reporterName !== undefined && !data.reporterName?.trim()) {
    ctx.addIssue({ code: "custom", path: ["reporterName"], message: "Name erforderlich" });
  }
});

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

// ─── Fahrzeuge ───────────────────────────────────────────────────────────────

export const allowedVehicleCreateSchema = z.object({
  name: z.string().min(1).max(80),
  plate: z.string().min(2).max(20),
  isActive: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
  cameraId: z.coerce.number().int().positive().nullable().optional(),
  doorbirdCameraId: z.coerce.number().int().positive().nullable().optional(),
  shellyDeviceId: z.coerce.number().int().positive().nullable().optional(),
  shellyAction: z.enum(["ON", "OFF", "TOGGLE"]).optional(),
  timerSeconds: z.coerce.number().int().min(1).max(3600).nullable().optional(),
  cooldownMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  notifyOnDetection: z.boolean().optional(),
});

export const allowedVehicleUpdateSchema = allowedVehicleCreateSchema.partial();

export const vehicleSightingCreateSchema = z.object({
  plate: z.string().min(2).max(20),
  cameraId: z.coerce.number().int().positive().nullable().optional(),
  seenAt: z.string().datetime().optional(),
});

export const vehicleSightingAssignSchema = z.object({
  allowedVehicleId: z.coerce.number().int().positive().nullable().optional(),
  plate: z.string().min(2).max(20).nullable().optional(),
  createVehicle: z
    .object({
      name: z.string().min(1).max(80),
      plate: z.string().min(2).max(20),
    })
    .nullable()
    .optional(),
}).refine(
  (v) => v.allowedVehicleId || v.plate || v.createVehicle,
  { message: "allowedVehicleId, plate oder createVehicle erforderlich" }
);

// ─── Personen (White-/Blacklist) ─────────────────────────────────────────────

export const listedPersonCreateSchema = z.object({
  name: z.string().min(1).max(120),
  listType: z.enum(["WHITELIST", "BLACKLIST"]),
  isActive: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
  cameraId: z.coerce.number().int().positive().nullable().optional(),
  trackHistory: z.boolean().optional(),
  triggerOnDetection: z.boolean().optional(),
  notifyOnDetection: z.boolean().optional(),
  shellyDeviceId: z.coerce.number().int().positive().nullable().optional(),
  shellyAction: z.enum(["ON", "OFF", "TOGGLE"]).optional(),
  timerSeconds: z.coerce.number().int().min(1).max(3600).nullable().optional(),
  cooldownMinutes: z.coerce.number().int().min(1).max(1440).optional(),
});

export const listedPersonUpdateSchema = listedPersonCreateSchema.partial();

export const personSightingCreateSchema = z.object({
  listedPersonId: z.coerce.number().int().positive(),
  cameraId: z.coerce.number().int().positive().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  triggerShelly: z.boolean().optional(),
});

export const personSightingAssignSchema = z.object({
  listedPersonId: z.coerce.number().int().positive(),
});

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ungültige Zeit (HH:mm)")
  .nullable();

export const surveillanceUpdateSchema = z.object({
  manualArmed: z.boolean().optional(),
  scheduleEnabled: z.boolean().optional(),
  daysOfWeek: z.coerce.number().int().min(0).max(127).optional(),
  windowStart: hhmm.optional(),
  windowEnd: hhmm.optional(),
  cooldownMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  alertOnPerson: z.boolean().optional(),
  alertOnVehicle: z.boolean().optional(),
  alertTelegram: z.boolean().optional(),
  cameraIds: z.array(z.coerce.number().int().positive()).optional(),
});

// ─── Schließanlage ───────────────────────────────────────────────────────────

const optionalDate = z
  .string()
  .refine((s) => s === "" || !isNaN(new Date(s).getTime()), "Ungültiges Datum")
  .nullable();

export const keyRoomCreateSchema = z.object({
  name: z.string().min(1).max(120),
  number: z.string().max(40).nullable().optional(),
  building: z.string().max(120).nullable().optional(),
  floor: z.string().max(60).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  /// IoT-Geräte, die in diesem Raum hängen (Vollersetzung).
  deviceIds: z.array(z.coerce.number().int().positive()).optional(),
  /// Kameras, die diesen Raum abdecken (Vollersetzung).
  cameraIds: z.array(z.coerce.number().int().positive()).optional(),
  /// Betriebszeit-Profil; null = keines.
  operatingScheduleId: z.coerce.number().int().positive().nullable().optional(),
});

export const keyRoomUpdateSchema = keyRoomCreateSchema.partial();

export const keyDoorCreateSchema = z.object({
  name: z.string().min(1).max(120),
  /// null = Gemeinschafts-/Aussentuer ohne Raumzuordnung.
  roomId: z.coerce.number().int().positive().nullable().optional(),
  doorNumber: z.string().max(40).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const keyDoorUpdateSchema = keyDoorCreateSchema.partial();

export const keyLockTypeSchema = z.enum(["CYLINDER", "PADLOCK", "ELECTRONIC", "OTHER"]);

export const keyLockCreateSchema = z.object({
  doorId: z.coerce.number().int().positive(),
  lockNumber: z.string().max(60).nullable().optional(),
  lockType: keyLockTypeSchema.optional(),
  system: z.string().max(120).nullable().optional(),
  manufacturer: z.string().max(120).nullable().optional(),
  installedAt: optionalDate.optional(),
  notes: z.string().max(1000).nullable().optional(),
  /// Gerät, das diesen Schließpunkt elektronisch öffnet. null = rein mechanisch.
  deviceId: z.coerce.number().int().positive().nullable().optional(),
});

export const keyLockUpdateSchema = keyLockCreateSchema.partial();

export const keyLevelSchema = z.enum(["SINGLE", "GROUP", "MAIN", "GRAND"]);
export const keyStatusSchema = z.enum(["AVAILABLE", "ISSUED", "LOST", "DESTROYED"]);

export const keyItemCreateSchema = z.object({
  keyNumber: z.string().min(1).max(60),
  label: z.string().max(120).nullable().optional(),
  level: keyLevelSchema.optional(),
  status: keyStatusSchema.optional(),
  notes: z.string().max(1000).nullable().optional(),
  /// IDs der Schlösser, die dieser Schlüssel sperrt (Vollersetzung).
  lockIds: z.array(z.coerce.number().int().positive()).optional(),
});

export const keyItemUpdateSchema = keyItemCreateSchema.partial();

/// Nummernserie anlegen: "Z12" + 1..5 -> "Z12-1" ... "Z12-5".
export const keyItemBulkCreateSchema = z.object({
  prefix: z.string().min(1).max(40),
  startIndex: z.coerce.number().int().min(0).max(9999).optional(),
  count: z.coerce.number().int().min(1).max(200),
  separator: z.string().max(3).optional(),
  /// Stellen der laufenden Nummer, z. B. 3 -> "Z12-001".
  padding: z.coerce.number().int().min(1).max(6).optional(),
  label: z.string().max(120).nullable().optional(),
  level: keyLevelSchema.optional(),
  notes: z.string().max(1000).nullable().optional(),
  lockIds: z.array(z.coerce.number().int().positive()).optional(),
});

export const keyHolderCreateSchema = z
  .object({
    /// Mitarbeiter-Ticket (source EMP_CONTROL) oder null für freie Erfassung.
    ticketId: z.coerce.number().int().positive().nullable().optional(),
    firstName: z.string().max(120).nullable().optional(),
    lastName: z.string().max(120).nullable().optional(),
    company: z.string().max(120).nullable().optional(),
    email: z.union([z.literal(""), z.string().email().max(180)]).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .refine(
    (v) => v.ticketId != null || !!v.lastName?.trim() || !!v.company?.trim(),
    { message: "Mitarbeiter, Nachname oder Firma erforderlich", path: ["lastName"] },
  );

export const keyHolderUpdateSchema = z.object({
  ticketId: z.coerce.number().int().positive().nullable().optional(),
  firstName: z.string().max(120).nullable().optional(),
  lastName: z.string().max(120).nullable().optional(),
  company: z.string().max(120).nullable().optional(),
  email: z.union([z.literal(""), z.string().email().max(180)]).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const keyPolicyCreateSchema = z.object({
  name: z.string().min(1).max(120),
  bodyText: z.string().min(1).max(20000),
  liabilityText: z.string().max(20000).nullable().optional(),
  isActive: z.boolean().optional(),
});

/// Textänderungen erzeugen eine neue Version; nur `isActive` wird in-place
/// geändert (siehe Route).
export const keyPolicyUpdateSchema = keyPolicyCreateSchema.partial();

export const keyHandoverCreateSchema = z
  .object({
    holderId: z.coerce.number().int().positive().nullable().optional(),
    /// Alternative zu `holderId`: Empfänger direkt mit anlegen.
    newHolder: keyHolderCreateSchema.optional(),
    keyIds: z.array(z.coerce.number().int().positive()).min(1),
    policyTemplateId: z.coerce.number().int().positive().nullable().optional(),
    issuedByName: z.string().max(120).nullable().optional(),
    dueAt: optionalDate.optional(),
    deposit: z.coerce.number().min(0).max(100000).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .refine((v) => v.holderId != null || v.newHolder != null, {
    message: "Empfänger erforderlich",
    path: ["holderId"],
  });

export const keyHandoverUpdateSchema = z.object({
  policyTemplateId: z.coerce.number().int().positive().nullable().optional(),
  dueAt: optionalDate.optional(),
  deposit: z.coerce.number().min(0).max(100000).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

/// Rückgabe: entweder ausgewählte Positionen oder alle offenen.
export const keyReturnSchema = z
  .object({
    itemIds: z.array(z.coerce.number().int().positive()).optional(),
    all: z.boolean().optional(),
    /// RETURNED = zurück im Bestand, LOST = als verloren markieren.
    itemStatus: z.enum(["RETURNED", "LOST"]).optional(),
    returnedByName: z.string().max(120).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .refine((v) => v.all === true || (v.itemIds?.length ?? 0) > 0, {
    message: "Keine Schlüssel ausgewählt",
    path: ["itemIds"],
  });

export const keySignatureCreateSchema = z.object({
  kind: z.enum(["HANDOVER", "RETURN"]).optional(),
  /// Gültigkeit des QR-Links in Tagen.
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
  policyTemplateId: z.coerce.number().int().positive().nullable().optional(),
});

/// Eingabe der öffentlichen Signaturseite.
export const keySignatureSubmitSchema = z.object({
  signedName: z.string().min(2).max(120),
  /// PNG-Data-URL aus dem Unterschriftenfeld (~max. 1 MB).
  signatureImage: z
    .string()
    .max(1_500_000, "Unterschrift zu groß")
    .refine((s) => s.startsWith("data:image/png;base64,"), "Ungültige Unterschrift"),
  acceptedPolicy: z.literal(true),
  acceptedLiability: z.boolean().optional(),
});

// ─── Betriebszeiten ──────────────────────────────────────────────────────────

/// Anders als `hhmm` weiter oben nicht nullable: eine Öffnungszeit ohne Uhrzeit
/// gibt es nicht.
const timeHhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Uhrzeit muss HH:mm sein");

const mmDd = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Datum muss MM-TT sein");

const ymd = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Datum muss JJJJ-MM-TT sein");

export const operatingPeriodSchema = z.object({
  /// 0=Mo … 6=So.
  weekday: z.coerce.number().int().min(0).max(6),
  opensAt: timeHhmm,
  closesAt: timeHhmm,
});

export const operatingSeasonSchema = z.object({
  name: z.string().min(1).max(80),
  startMmDd: mmDd,
  endMmDd: mmDd,
  sortOrder: z.coerce.number().int().min(0).optional(),
  /// Öffnungszeiten dieser Saison (Vollersetzung).
  periods: z.array(operatingPeriodSchema).max(70).default([]),
});

export const operatingExceptionSchema = z
  .object({
    date: ymd,
    closed: z.boolean().default(true),
    opensAt: timeHhmm.nullable().optional(),
    closesAt: timeHhmm.nullable().optional(),
    note: z.string().max(200).nullable().optional(),
  })
  .refine((v) => v.closed || (!!v.opensAt && !!v.closesAt), {
    message: "Sonderöffnung braucht Beginn und Ende",
    path: ["opensAt"],
  });

export const operatingScheduleCreateSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  /// Saisons samt Öffnungszeiten (Vollersetzung, wenn angegeben).
  seasons: z.array(operatingSeasonSchema).max(12).optional(),
  /// Ausnahmetage (Vollersetzung, wenn angegeben).
  exceptions: z.array(operatingExceptionSchema).max(400).optional(),
});

export const operatingScheduleUpdateSchema = operatingScheduleCreateSchema.partial();

// ─── Raumregeln ──────────────────────────────────────────────────────────────

const ruleTrigger = z.enum([
  "TIME",
  "OPENING",
  "CLOSING",
  "SUNRISE",
  "SUNSET",
  "MOTION",
  "DEVICE_SWITCHED",
  "SCAN",
  "IDLE",
]);

export const roomRuleActionSchema = z
  .object({
    kind: z.enum(["DEVICE", "NOTIFY", "AUDIO"]),
    sortOrder: z.coerce.number().int().min(0).optional(),
    deviceId: z.coerce.number().int().positive().nullable().optional(),
    deviceAction: z.string().max(40).nullable().optional(),
    timerSeconds: z.coerce.number().int().min(1).max(86400).nullable().optional(),
    channel: z.enum(["TELEGRAM", "PUSH", "BOTH"]).nullable().optional(),
    message: z.string().max(500).nullable().optional(),
    audioZoneId: z.coerce.number().int().positive().nullable().optional(),
    audioAnnouncementId: z.coerce.number().int().positive().nullable().optional(),
    audioPlaylistId: z.coerce.number().int().positive().nullable().optional(),
  })
  .refine((v) => v.kind !== "DEVICE" || (!!v.deviceId && !!v.deviceAction), {
    message: "Geräte-Aktion braucht Gerät und Schaltbefehl",
    path: ["deviceId"],
  })
  .refine((v) => v.kind !== "AUDIO" || !!v.audioZoneId, {
    message: "Audio-Aktion braucht eine Zone",
    path: ["audioZoneId"],
  })
  .refine((v) => v.kind !== "AUDIO" || !(v.audioAnnouncementId && v.audioPlaylistId), {
    message: "Entweder Durchsage oder Playlist, nicht beides",
    path: ["audioPlaylistId"],
  });

export const roomRuleCreateSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(500).nullable().optional(),
    /// null = betriebsweite Regel ohne Raumbezug.
    roomId: z.coerce.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),

    trigger: ruleTrigger,
    daysOfWeek: z.coerce.number().int().min(0).max(127).optional(),
    timeOfDay: hhmm.optional(),
    offsetMinutes: z.coerce.number().int().min(-720).max(720).optional(),

    cameraId: z.coerce.number().int().positive().nullable().optional(),
    eventType: z.enum(["PERSON", "VEHICLE", "MOTION"]).nullable().optional(),

    triggerDeviceId: z.coerce.number().int().positive().nullable().optional(),
    triggerAction: z.string().max(40).nullable().optional(),

    areaId: z.coerce.number().int().positive().nullable().optional(),
    scanDirection: z.enum(["IN", "OUT"]).nullable().optional(),

    idleMinutes: z.coerce.number().int().min(1).max(1440).nullable().optional(),

    operating: z.enum(["ANY", "OPEN", "CLOSED"]).optional(),
    operatingScheduleId: z.coerce.number().int().positive().nullable().optional(),
    windowStart: hhmm.optional(),
    windowEnd: hhmm.optional(),
    onlyWhenDark: z.boolean().optional(),
    cooldownSeconds: z.coerce.number().int().min(0).max(86400).optional(),

    /// Aktionen der Regel (Vollersetzung, wenn angegeben).
    actions: z.array(roomRuleActionSchema).max(20).optional(),
  })
  .refine((v) => v.trigger !== "TIME" || !!v.timeOfDay, {
    message: "Uhrzeit fehlt",
    path: ["timeOfDay"],
  })
  .refine((v) => v.trigger !== "DEVICE_SWITCHED" || !!v.triggerDeviceId, {
    message: "Auslösendes Gerät fehlt",
    path: ["triggerDeviceId"],
  })
  .refine((v) => v.trigger !== "IDLE" || (!!v.idleMinutes && !!v.roomId), {
    message: "Ruhe im Raum braucht einen Raum und eine Dauer",
    path: ["idleMinutes"],
  })
  .refine((v) => v.trigger !== "MOTION" || !!v.cameraId || !!v.roomId, {
    message: "Bewegung braucht eine Kamera oder einen Raum",
    path: ["cameraId"],
  });

/// Für Teiländerungen: `.partial()` auf einem verfeinerten Schema geht nicht,
/// deshalb die Prüfungen hier bewusst nur beim Anlegen. Die Oberfläche schickt
/// beim Bearbeiten ohnehin den vollständigen Satz.
export const roomRuleUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  roomId: z.coerce.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  trigger: ruleTrigger.optional(),
  daysOfWeek: z.coerce.number().int().min(0).max(127).optional(),
  timeOfDay: hhmm.optional(),
  offsetMinutes: z.coerce.number().int().min(-720).max(720).optional(),
  cameraId: z.coerce.number().int().positive().nullable().optional(),
  eventType: z.enum(["PERSON", "VEHICLE", "MOTION"]).nullable().optional(),
  triggerDeviceId: z.coerce.number().int().positive().nullable().optional(),
  triggerAction: z.string().max(40).nullable().optional(),
  areaId: z.coerce.number().int().positive().nullable().optional(),
  scanDirection: z.enum(["IN", "OUT"]).nullable().optional(),
  idleMinutes: z.coerce.number().int().min(1).max(1440).nullable().optional(),
  operating: z.enum(["ANY", "OPEN", "CLOSED"]).optional(),
  operatingScheduleId: z.coerce.number().int().positive().nullable().optional(),
  windowStart: hhmm.optional(),
  windowEnd: hhmm.optional(),
  onlyWhenDark: z.boolean().optional(),
  cooldownSeconds: z.coerce.number().int().min(0).max(86400).optional(),
  actions: z.array(roomRuleActionSchema).max(20).optional(),
});
