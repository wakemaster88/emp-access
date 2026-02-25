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
  })
);

export const ticketCreateSchema = z.object({
  name: z.string().min(1),
  qrCode: z.string().optional(),
  rfidCode: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  accessAreaId: z.coerce.number().int().optional(),
  status: z.enum(["VALID", "INVALID", "PROTECTED"]).optional(),
  barcode: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  ticketTypeName: z.string().optional(),
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
