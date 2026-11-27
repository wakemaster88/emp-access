import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { WebcamControlCenter } from "@/components/webcams/control-center";
import { shownSnapshotAt } from "@/lib/camera-live-mode";

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
      where: { accountId, enabled: true, kind: { in: ["REOLINK", "DOORBIRD"] } },
      select: {
        id: true,
        name: true,
        kind: true,
        host: true,
        channel: true,
        snapshotAt: true,
        lastSeenAt: true,
        liveMode: true,
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
      <Header title="Kontrollzentrum" accountName={session.user.accountName} />
      <div className="page-content space-y-4 sm:space-y-5">
        <WebcamControlCenter
          // Livebild und Vorschau „nur auf Tippen“ oder „aus“: kein Bild, die
          // Steuerung bleibt (bei „aus“ ohne Bildflaeche, siehe CameraPanel).
          cameras={cameras.map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.kind,
            host: c.host,
            channel: c.channel,
            snapshotAt: shownSnapshotAt(c.liveMode, c.snapshotAt?.toISOString() ?? null),
            lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
            liveMode: c.liveMode,
          }))}
          hubOnline={hubOnline}
        />
      </div>
    </>
  );
}
