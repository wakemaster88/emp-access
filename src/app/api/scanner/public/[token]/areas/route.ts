import { NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";

/**
 * Oeffentliches Areas-Listing fuer den Token-Scanner. Authentifizierung
 * erfolgt ueber den Monitor-Token (`MonitorConfig.type === "SCANNER"`).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "SCANNER") {
    return NextResponse.json(
      { error: "Scanner nicht gefunden oder inaktiv" },
      { status: 404 },
    );
  }

  const db = tenantClient(monitor.accountId);
  const areas = await db.accessArea.findMany({
    where: { accountId: monitor.accountId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(areas, {
    headers: { "Cache-Control": "no-store" },
  });
}
