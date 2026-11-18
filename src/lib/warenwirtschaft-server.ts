import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { COUNT_LINK_DAYS } from "@/lib/warenwirtschaft";
import { getSessionWithDb } from "@/lib/api-auth";
import type { TenantDb } from "@/lib/prisma";

/**
 * Sitzung mit Mandanten-Datenbank für die Warenwirtschaft. Der Super-Admin
 * hat kein eigenes Konto und bekommt hier keinen Schreibzugriff.
 */
export async function wawiSession(): Promise<{ error: NextResponse } | { db: TenantDb; accountId: number; userName: string }> {
  const s = await getSessionWithDb();
  if ("error" in s) return { error: s.error! };
  if (s.isSuperAdmin || !s.accountId) {
    return { error: NextResponse.json({ error: "Nur innerhalb eines Kontos möglich" }, { status: 403 }) };
  }
  return { db: s.db, accountId: s.accountId, userName: s.session.user.name || s.session.user.email || "Unbekannt" };
}

export function badRequest(error: unknown) {
  return NextResponse.json({ error }, { status: 400 });
}

export function notFound(what = "Eintrag") {
  return NextResponse.json({ error: `${what} nicht gefunden` }, { status: 404 });
}

/** Datum „2025-12-31“ als 00:00 UTC. */
export function dateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

const qty = z.number().finite().min(-1_000_000).max(1_000_000);
const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
// Eigenes Foto als verkleinerte Data-URL (max. ~1,5 MB) oder https-Adresse.
const image = z
  .string()
  .max(2_000_000)
  .refine((v) => v.startsWith("data:image/") || v.startsWith("https://"), "Bild muss ein Foto oder eine https-Adresse sein")
  .nullable()
  .optional();

export const articleSchema = z.object({
  name: z.string().trim().min(1, "Name erforderlich").max(200),
  sku: optText(60),
  category: z.string().trim().min(1).max(60).default("Sonstiges"),
  unit: optText(40),
  supplier: optText(120),
  purchasePriceCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  stock: qty.optional(),
  image,
  imageSource: optText(200),
  active: z.boolean().optional(),
  note: optText(1000),
});

export const stocktakeCreateSchema = z.object({
  kind: z.enum(["ROLLING", "CUTOFF"]),
  title: z.string().trim().max(120).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Nur bei laufender Inventur: leer = alle Kategorien. */
  categories: z.array(z.string().max(60)).max(50).optional(),
  note: optText(1000),
});

export const stocktakeLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        id: z.number().int(),
        counted: qty.nullable().optional(),
        broken: qty.nullable().optional(),
      }),
    )
    .min(1)
    .max(1000),
});

export const assetSchema = z.object({
  name: z.string().trim().min(1, "Name erforderlich").max(200),
  group: z.string().trim().min(1).max(60),
  location: optText(80),
  deviceNumber: optText(80),
  lastInspection: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: optText(1000),
  counts: z.array(z.object({ year: z.number().int().min(2000).max(2100), quantity: qty.nullable() })).max(50).optional(),
});

export const assetCountSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  quantity: qty.nullable(),
});

/** Neues Geheimnis für den Zähl-Link (32 Byte, base64url). */
export function newCountToken(): string {
  return randomBytes(32).toString("base64url");
}

export function countTokenExpiry(days = COUNT_LINK_DAYS, now = new Date()): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

export const countLinkCreateSchema = z.object({
  days: z.number().int().min(1).max(90).optional(),
});

/** Eingaben über den Zähl-Link: Name der zählenden Person plus Mengen. */
export const publicCountSchema = z.object({
  name: z.string().trim().min(1, "Bitte deinen Namen eingeben").max(60),
  lines: stocktakeLinesSchema.shape.lines.max(200),
});
