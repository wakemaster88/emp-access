import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { CamerasView } from "@/components/cameras/cameras-view";

export default async function CamerasPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const accountId = session.user.accountId;
  const db = tenantClient(accountId);

  const [cameras, events, hubAgents] = await Promise.all([
    db.camera.findMany({
      where: { accountId },
      select: {
        id: true,
        name: true,
        host: true,
        httpPort: true,
        https: true,
        username: true,
        channel: true,
        enabled: true,
        notes: true,
        snapshotAt: true,
        lastSeenAt: true,
      },
      orderBy: { name: "asc" },
    }),
    db.cameraEvent.findMany({
      where: { accountId },
      include: { camera: { select: { id: true, name: true } } },
      orderBy: { startedAt: "desc" },
      take: 50,
    }),
    db.hubAgent.findMany({
      where: { accountId },
      select: { name: true, lastSeenAt: true },
    }),
  ]);

  const fiveMinAgo = new Date();
  fiveMinAgo.setMinutes(fiveMinAgo.getMinutes() - 5);
  const hubOnline = hubAgents.some((h) => h.lastSeenAt && h.lastSeenAt > fiveMinAgo);

  return (
    <>
      <Header title="Kameras" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <CamerasView
          cameras={cameras.map((c) => ({
            ...c,
            snapshotAt: c.snapshotAt?.toISOString() ?? null,
            lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
          }))}
          events={events.map((e) => ({
            id: e.id,
            type: e.type,
            startedAt: e.startedAt.toISOString(),
            endedAt: e.endedAt?.toISOString() ?? null,
            camera: e.camera,
          }))}
          hubOnline={hubOnline}
        />
      </div>
    </>
  );
}
