import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { z } from "zod";
import {
  DEFAULT_DATA_RETENTION,
  RETENTION_KEYS,
  parseDataRetention,
  retentionToJson,
  type DataRetentionConfig,
  type RetentionKey,
} from "@/lib/data-retention";

const dayOrNull = z.union([
  z.null(),
  z.coerce.number().int().min(1).max(3650),
]);

const retentionPatchSchema = z
  .object({
    vehicleSightings: dayOrNull.optional(),
    personSightings: dayOrNull.optional(),
    cameraEvents: dayOrNull.optional(),
    scans: dayOrNull.optional(),
    irrigationRuns: dayOrNull.optional(),
    automationRuns: dayOrNull.optional(),
    emailSends: dayOrNull.optional(),
    hubTasks: dayOrNull.optional(),
    discoveredDevices: dayOrNull.optional(),
    audioJobs: dayOrNull.optional(),
  })
  .strict();

/** GET (Session): aktuelle Löschfristen inkl. Defaults. */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const account = await db.account.findUnique({
    where: { id: accountId! },
    select: { dataRetention: true },
  });

  return NextResponse.json({
    retention: parseDataRetention(account?.dataRetention),
    defaults: DEFAULT_DATA_RETENTION,
  });
}

/** PATCH (Session): Löschfristen speichern. */
export async function PATCH(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json().catch(() => null);
  const parsed = retentionPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await db.account.findUnique({
    where: { id: accountId! },
    select: { dataRetention: true },
  });
  const merged: DataRetentionConfig = {
    ...parseDataRetention(existing?.dataRetention),
  };
  for (const key of RETENTION_KEYS) {
    if (key in parsed.data && parsed.data[key] !== undefined) {
      merged[key] = parsed.data[key] as number | null;
    }
  }

  await db.account.update({
    where: { id: accountId! },
    data: { dataRetention: retentionToJson(merged) },
  });

  return NextResponse.json({ retention: merged });
}
