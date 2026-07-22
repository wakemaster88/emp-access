import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { WebcamControlCenter } from "@/components/webcams/control-center";

/**
 * Webcam-Kontrollzentrum: Live-Steuerung der Reolink-Kameras
 * (PTZ, Presets, Scheinwerfer, IR, Sirene) ueber den lokalen Hub.
 */
export default async function WebcamsPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const accountId = session.user.accountId;
  const db = tenantClient(accountId);

  const [cameras, hubAgents] = await Promise.all([
    db.camera.findMany({
      where: { accountId, kind: "REOLINK", enabled: true },
      select: {
        id: true,
        name: true,
        host: true,
        channel: true,
        snapshotAt: true,
        lastSeenAt: true,
      },
      orderBy: { name: "asc" },
    }),
    db.hubAgent.findMany({
      where: { accountId },
      select: { lastSeenAt: true },
    }),
  ]);

  const fiveMinAgo = new Date();
  fiveMinAgo.setMinutes(fiveMinAgo.getMinutes() - 5);
  const hubOnline = hubAgents.some((h) => h.lastSeenAt && h.lastSeenAt > fiveMinAgo);

  return (
    <>
      <Header title="Webcam-Kontrollzentrum" accountName={session.user.accountName} />
      <div className="p-2 sm:p-3">
        <WebcamControlCenter
          cameras={cameras.map((c) => ({
            id: c.id,
            name: c.name,
            host: c.host,
            channel: c.channel,
            snapshotAt: c.snapshotAt?.toISOString() ?? null,
            lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
          }))}
          hubOnline={hubOnline}
        />
      </div>
    </>
  );
}
