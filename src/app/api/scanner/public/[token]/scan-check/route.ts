import { NextRequest, NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { prisma, tenantClient } from "@/lib/prisma";
import { performScanCheck } from "@/lib/scan-check";

/**
 * Token-basierter Scanner: identische Scan-Logik wie `/api/scan-check`,
 * Authentifizierung erfolgt ueber den Monitor-Token (Typ "SCANNER").
 */
export async function POST(
  request: NextRequest,
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

  const body = await request.json().catch(() => ({}));
  const code = String(body?.code ?? "");
  const accessAreaId = body?.accessAreaId ? Number(body.accessAreaId) : undefined;

  const deviceIds = (monitor.deviceIds as number[]) ?? [];
  const deviceId = deviceIds.length > 0 ? deviceIds[0] : null;

  const db = tenantClient(monitor.accountId);
  const result = await performScanCheck({
    db: db as unknown as PrismaClient,
    accountId: monitor.accountId,
    code,
    accessAreaId,
    deviceId,
  });

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
