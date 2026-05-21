import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 10;

/**
 * Dismissed eine Announcement aus dem Public-Monitor heraus. Sobald
 * `dismissedAt` gesetzt ist, wird der Hinweis auf KEINEM Monitor mehr
 * angezeigt - das ist gewollt: "manuell schliessen" gilt account-weit.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const announcementId = Number(id);
  if (!Number.isFinite(announcementId) || announcementId <= 0) {
    return NextResponse.json({ error: "Ungueltige ID" }, { status: 400 });
  }

  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  // Account-scoped: nur Announcements des eigenen Accounts duerfen dismissed
  // werden. Verhindert, dass ein Monitor-Token aus Account A einen Hinweis in
  // Account B schliesst (selbst wenn die ID erraten waere).
  const result = await prisma.monitorAnnouncement.updateMany({
    where: {
      id: announcementId,
      accountId: monitor.accountId,
      dismissedAt: null,
    },
    data: { dismissedAt: new Date() },
  });

  if (result.count === 0) {
    return NextResponse.json({ ok: true, alreadyDismissed: true });
  }
  return NextResponse.json({ ok: true });
}
