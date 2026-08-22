import { safeAuth } from "@/lib/auth";
import { prisma, tenantClient } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { VehiclesClient } from "@/components/vehicles/vehicles-client";

export const dynamic = "force-dynamic";

export default async function FahrzeugePage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const accountId = session.user.accountId;
  const db = tenantClient(accountId);

  const sightingSelect = {
    id: true,
    plate: true,
    source: true,
    matched: true,
    shellyTriggered: true,
    shellyOk: true,
    seenAt: true,
    camera: { select: { id: true, name: true } },
    allowedVehicle: { select: { id: true, name: true, plate: true } },
  } as const;

  const [vehicles, sightings, shellyDevices, cameras, hubAgents, openVehicleEvents] = await Promise.all([
    db.allowedVehicle.findMany({
      where: { accountId },
      include: {
        shellyDevice: { select: { id: true, name: true } },
        camera: { select: { id: true, name: true } },
        doorbird: { select: { id: true, name: true } },
        _count: { select: { sightings: true } },
        sightings: {
          select: sightingSelect,
          orderBy: { seenAt: "desc" },
          take: 8,
        },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    db.vehicleSighting.findMany({
      where: { accountId },
      select: sightingSelect,
      orderBy: { seenAt: "desc" },
      take: 100,
    }),
    db.device.findMany({
      where: { accountId, type: "SHELLY" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.camera.findMany({
      where: { accountId },
      select: {
        id: true,
        name: true,
        kind: true,
        vehicleDetection: true,
        snapshotAt: true,
        lastSeenAt: true,
      },
      orderBy: { name: "asc" },
    }),
    db.hubAgent.findMany({
      where: { accountId },
      select: { name: true, lastSeenAt: true },
      orderBy: { lastSeenAt: "desc" },
    }),
    db.cameraEvent.findMany({
      where: { accountId, type: "VEHICLE", endedAt: null },
      select: { id: true, cameraId: true, startedAt: true },
    }),
  ]);

  const allSightingIds = [
    ...sightings.map((s) => s.id),
    ...vehicles.flatMap((v) => v.sightings.map((s) => s.id)),
  ];
  const uniqueIds = [...new Set(allSightingIds)];

  const snapIds = new Set<number>();
  if (uniqueIds.length > 0) {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM "VehicleSighting"
      WHERE "accountId" = ${accountId}
        AND snapshot IS NOT NULL
        AND id IN (${Prisma.join(uniqueIds)})
    `;
    for (const r of rows) snapIds.add(r.id);
  }

  function mapSighting(s: (typeof sightings)[number]) {
    return {
      ...s,
      seenAt: s.seenAt.toISOString(),
      hasSnapshot: snapIds.has(s.id),
    };
  }

  const fiveMinAgo = new Date();
  fiveMinAgo.setMinutes(fiveMinAgo.getMinutes() - 5);
  const liveHub = hubAgents.find((h) => h.lastSeenAt && h.lastSeenAt > fiveMinAgo) ?? hubAgents[0] ?? null;
  const hubOnline = !!(liveHub?.lastSeenAt && liveHub.lastSeenAt > fiveMinAgo);

  return (
    <>
      <Header title="Fahrzeuge" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <VehiclesClient
          vehicles={vehicles.map((v) => {
            const { sightings: recentSightings, ...rest } = v;
            return {
              ...rest,
              lastTriggeredAt: v.lastTriggeredAt?.toISOString() ?? null,
              recentSightings: recentSightings.map(mapSighting),
            };
          })}
          sightings={sightings.map(mapSighting)}
          shellyDevices={shellyDevices}
          cameras={cameras.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
          parkingCameras={cameras.map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.kind,
            vehicleDetection: c.vehicleDetection,
            snapshotAt: c.snapshotAt?.toISOString() ?? null,
            lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
          }))}
          hubOnline={hubOnline}
          hubName={liveHub?.name ?? null}
          openVehicleEvents={openVehicleEvents.map((e) => ({
            id: e.id,
            cameraId: e.cameraId,
            startedAt: e.startedAt.toISOString(),
          }))}
        />
      </div>
    </>
  );
}
