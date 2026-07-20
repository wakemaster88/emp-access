import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
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

  const [vehicles, sightings, shellyDevices] = await Promise.all([
    db.allowedVehicle.findMany({
      where: { accountId },
      include: {
        shellyDevice: { select: { id: true, name: true } },
        _count: { select: { sightings: true } },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    db.vehicleSighting.findMany({
      where: { accountId },
      include: {
        camera: { select: { id: true, name: true } },
        allowedVehicle: { select: { id: true, name: true, plate: true } },
      },
      orderBy: { seenAt: "desc" },
      take: 100,
    }),
    db.device.findMany({
      where: { accountId, type: "SHELLY" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <Header title="Fahrzeuge" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <VehiclesClient
          vehicles={vehicles.map((v) => ({
            ...v,
            lastTriggeredAt: v.lastTriggeredAt?.toISOString() ?? null,
          }))}
          sightings={sightings.map((s) => ({
            ...s,
            seenAt: s.seenAt.toISOString(),
          }))}
          shellyDevices={shellyDevices}
        />
      </div>
    </>
  );
}
