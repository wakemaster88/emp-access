import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWithDb } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { generatePortalToken, PORTAL_OPENABLE_TYPES } from "@/lib/verein-portal";

const putSchema = z.object({
  enabled: z.boolean(),
  cancelHours: z.coerce.number().int().min(0).max(24 * 60),
  horizonDays: z.coerce.number().int().min(1).max(730),
  leadMinutes: z.coerce.number().int().min(0).max(24 * 60),
  trailMinutes: z.coerce.number().int().min(0).max(24 * 60),
  deviceIds: z.array(z.coerce.number().int().positive()).max(50),
  doorbirdIds: z.array(z.coerce.number().int().positive()).max(50),
  billingContact: z.string().trim().max(500).nullable().optional(),
  services: z
    .array(z.object({
      serviceId: z.coerce.number().int().positive(),
      priceCents: z.coerce.number().int().min(0).max(10_000_000),
    }))
    .max(100),
});

async function loadVerein(request: NextRequest | null, params: Promise<{ id: string }>) {
  const session = await getSessionWithDb();
  if ("error" in session) return { error: session.error };
  if (session.accountId == null) {
    return { error: NextResponse.json({ error: "Kein Mandant" }, { status: 403 }) };
  }
  const { id } = await params;
  const vereinId = Number(id);
  if (!Number.isInteger(vereinId)) return { error: NextResponse.json({ error: "Ungültige ID" }, { status: 400 }) };
  const verein = await session.db.verein.findFirst({ where: { id: vereinId, accountId: session.accountId } });
  if (!verein) return { error: NextResponse.json({ error: "Nicht gefunden" }, { status: 404 }) };
  return { verein, accountId: session.accountId };
}

async function serialize(vereinId: number, accountId: number) {
  const [verein, services, devices, doorbirds] = await Promise.all([
    prisma.verein.findFirst({
      where: { id: vereinId, accountId },
      select: {
        portalToken: true,
        portalEnabled: true,
        portalCancelHours: true,
        portalHorizonDays: true,
        billingContact: true,
        portalLeadMinutes: true,
        portalTrailMinutes: true,
        portalDeviceIds: true,
        portalDoorbirdIds: true,
        bookableServices: { select: { serviceId: true, priceCents: true } },
      },
    }),
    prisma.service.findMany({ where: { accountId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.device.findMany({
      where: { accountId, type: { in: [...PORTAL_OPENABLE_TYPES] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.camera.findMany({ where: { accountId, kind: "DOORBIRD" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    token: verein?.portalToken ?? null,
    enabled: verein?.portalEnabled ?? false,
    cancelHours: verein?.portalCancelHours ?? 48,
    horizonDays: verein?.portalHorizonDays ?? 60,
    billingContact: verein?.billingContact ?? null,
    leadMinutes: verein?.portalLeadMinutes ?? 30,
    trailMinutes: verein?.portalTrailMinutes ?? 30,
    deviceIds: verein?.portalDeviceIds ?? [],
    doorbirdIds: verein?.portalDoorbirdIds ?? [],
    services: verein?.bookableServices ?? [],
    allServices: services,
    allDevices: devices,
    allDoorbirds: doorbirds,
  };
}

/** Portal-Einstellungen eines Vereins plus Liste aller Services. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const loaded = await loadVerein(null, params);
  if ("error" in loaded) return loaded.error;
  return NextResponse.json(await serialize(loaded.verein.id, loaded.accountId));
}

/** Speichert Portal-Einstellungen und freigegebene Services mit Preis. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const loaded = await loadVerein(request, params);
  if ("error" in loaded) return loaded.error;
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { verein, accountId } = loaded;
  const data = parsed.data;

  const validServiceIds = new Set(
    (await prisma.service.findMany({
      where: { accountId, id: { in: data.services.map((s) => s.serviceId) } },
      select: { id: true },
    })).map((s) => s.id),
  );
  const services = data.services.filter((s) => validServiceIds.has(s.serviceId));
  const [validDevices, validDoorbirds] = await Promise.all([
    prisma.device.findMany({
      where: { accountId, id: { in: data.deviceIds }, type: { in: [...PORTAL_OPENABLE_TYPES] } },
      select: { id: true },
    }),
    prisma.camera.findMany({ where: { accountId, id: { in: data.doorbirdIds }, kind: "DOORBIRD" }, select: { id: true } }),
  ]);

  await prisma.$transaction(async (tx) => {
    await tx.verein.update({
      where: { id: verein.id },
      data: {
        portalEnabled: data.enabled,
        portalCancelHours: data.cancelHours,
        portalHorizonDays: data.horizonDays,
        billingContact: data.billingContact || null,
        portalLeadMinutes: data.leadMinutes,
        portalTrailMinutes: data.trailMinutes,
        portalDeviceIds: validDevices.map((d) => d.id),
        portalDoorbirdIds: validDoorbirds.map((c) => c.id),
        ...(data.enabled && !verein.portalToken ? { portalToken: generatePortalToken() } : {}),
      },
    });
    await tx.vereinBookableService.deleteMany({ where: { vereinId: verein.id } });
    if (services.length > 0) {
      await tx.vereinBookableService.createMany({
        data: services.map((s) => ({ vereinId: verein.id, serviceId: s.serviceId, priceCents: s.priceCents })),
      });
    }
  });
  return NextResponse.json(await serialize(verein.id, accountId));
}

/** `{ action: "rotate" }`: neuer Link, der alte gilt sofort nicht mehr. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const loaded = await loadVerein(request, params);
  if ("error" in loaded) return loaded.error;
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "rotate") return NextResponse.json({ error: "Unbekannte Aktion" }, { status: 400 });
  await prisma.verein.update({ where: { id: loaded.verein.id }, data: { portalToken: generatePortalToken() } });
  return NextResponse.json(await serialize(loaded.verein.id, loaded.accountId));
}
