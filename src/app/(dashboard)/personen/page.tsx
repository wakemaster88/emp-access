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

  const sightingSelect = {
    id: true,
    source: true,
    listType: true,
    matched: true,
    matchScore: true,
    matchMethod: true,
    shellyTriggered: true,
    shellyOk: true,
    notes: true,
    seenAt: true,
    camera: { select: { id: true, name: true } },
    listedPerson: { select: { id: true, name: true, listType: true } },
  } as const;

  const [people, sightings, cameras, shellyDevices] = await Promise.all([
    db.listedPerson.findMany({
      where: { accountId },
      include: {
        camera: { select: { id: true, name: true } },
        shellyDevice: { select: { id: true, name: true } },
        _count: { select: { sightings: true, faceEmbeddings: true } },
        sightings: {
          select: sightingSelect,
          orderBy: { seenAt: "desc" },
          take: 8,
        },
      },
      orderBy: [{ isActive: "desc" }, { listType: "asc" }, { name: "asc" }],
    }),
    db.personSighting.findMany({
      where: { accountId },
      select: sightingSelect,
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

  const allSightingIds = [
    ...sightings.map((s) => s.id),
    ...people.flatMap((p) => p.sightings.map((s) => s.id)),
  ];
  const uniqueIds = [...new Set(allSightingIds)];

  const snapIds = new Set<number>();
  if (uniqueIds.length > 0) {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM "PersonSighting"
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

  return (
    <>
      <Header title="Personen" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <PersonsClient
          people={people.map((p) => {
            const { sightings: recentSightings, ...rest } = p;
            return {
              ...rest,
              listType: p.listType as "WHITELIST" | "BLACKLIST",
              lastTriggeredAt: p.lastTriggeredAt?.toISOString() ?? null,
              recentSightings: recentSightings.map(mapSighting),
            };
          })}
          sightings={sightings.map(mapSighting)}
          cameras={cameras}
          shellyDevices={shellyDevices}
        />
      </div>
    </>
  );
}
