import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { ingestHubScanDevices } from "@/lib/network-scan-ingest";

/** Hub meldet das Ergebnis eines Tasks zurueck (Token-Auth). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const { id } = await params;
  const taskId = Number(id);
  if (isNaN(taskId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const task = await db.hubTask.findFirst({
    where: { id: taskId, accountId: account.id },
  });
  if (!task) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const success = body.success !== false;

  // Aeltere Hub-Versionen liefern bei NETWORK_SCAN nur ARP-Listen im Task-Result
  // (ohne /api/hub/scan-Upload) – diese hier nachziehen.
  let ingest: { processed: number; synced: number } | null = null;
  if (success && task.type === "NETWORK_SCAN") {
    const result = body.result as { devices?: unknown[] } | null;
    if (Array.isArray(result?.devices) && result.devices.length > 0) {
      const hub = await db.hubAgent.findFirst({
        where: { accountId: account.id },
        orderBy: { lastSeenAt: "desc" },
        select: { name: true },
      });
      ingest = await ingestHubScanDevices(
        db,
        account.id,
        result.devices,
        hub?.name ?? null
      );
    }
  }

  const updated = await db.hubTask.update({
    where: { id: taskId },
    data: {
      status: success ? "DONE" : "FAILED",
      result: body.result ?? undefined,
      error: success ? null : (body.error || "Unbekannter Fehler"),
      finishedAt: new Date(),
    },
  });
  return NextResponse.json({ ...updated, ingest });
}
