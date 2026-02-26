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

export const accountUpdateSchema = accountCreateSchema.partial();
