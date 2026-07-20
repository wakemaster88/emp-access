import { safeAuth } from "@/lib/auth";
import { prisma, tenantClient } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { PersonsClient } from "@/components/persons/persons-client";

export const dynamic = "force-dynamic";

export default async function PersonenPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const accountId = session.user.accountId;
  const db = tenantClient(accountId);

  const [people, sightings, cameras, shellyDevices] = await Promise.all([
    db.listedPerson.findMany({
      where: { accountId },
      include: {
        camera: { select: { id: true, name: true } },
        shellyDevice: { select: { id: true, name: true } },
        _count: { select: { sightings: true } },
      },
      orderBy: [{ isActive: "desc" }, { listType: "asc" }, { name: "asc" }],
    }),
    db.personSighting.findMany({
      where: { accountId },
      select: {
        id: true,
        source: true,
        listType: true,
        matched: true,
        shellyTriggered: true,
        shellyOk: true,
        notes: true,
        seenAt: true,
        camera: { select: { id: true, name: true } },
        listedPerson: { select: { id: true, name: true, listType: true } },
      },
      orderBy: { seenAt: "desc" },
      take: 100,
    }),
    db.camera.findMany({
      where: { accountId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.device.findMany({
      where: { accountId, type: "SHELLY" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const snapIds = new Set<number>();
  if (sightings.length > 0) {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM "PersonSighting"
      WHERE "accountId" = ${accountId}
        AND snapshot IS NOT NULL
        AND id IN (${Prisma.join(sightings.map((s) => s.id))})
    `;
    for (const r of rows) snapIds.add(r.id);
  }

  return (
    <>
      <Header title="Personen" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <PersonsClient
          people={people.map((p) => ({
            ...p,
            listType: p.listType as "WHITELIST" | "BLACKLIST",
            lastTriggeredAt: p.lastTriggeredAt?.toISOString() ?? null,
          }))}
          sightings={sightings.map((s) => ({
            ...s,
            seenAt: s.seenAt.toISOString(),
            hasSnapshot: snapIds.has(s.id),
          }))}
          cameras={cameras}
          shellyDevices={shellyDevices}
        />
      </div>
    </>
  );
}
