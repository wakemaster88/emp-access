import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;

  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "BINARYTEC" },
  });

  if (!config) {
    return NextResponse.json({ error: "Binarytec not configured" }, { status: 404 });
  }

  try {
    const baseUrl = config.baseUrl || "https://server693.planet-holding.com";
    const since = config.lastUpdate
      ? Math.floor(config.lastUpdate.getTime() / 1000)
      : 0;

    const res = await fetch(
      `${baseUrl}/api/v1/raspi/access-controls/get-all-accesses-since`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({ since: String(since) }),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `Binarytec API error: ${res.status}` },
        { status: 502 }
      );
    }

    const tickets = await res.json();
    const ticketArr: Array<Record<string, unknown>> = Array.isArray(tickets) ? tickets : [];

    // Batch-Lookup statt findFirst pro Ticket (N+1 → 1 Query).
    const uuids = ticketArr
      .map((t) => t.uuid)
      .filter((u): u is string => typeof u === "string" && u.length > 0);
    const existingRows = uuids.length
      ? await db.ticket.findMany({
          where: { uuid: { in: uuids }, accountId: accountId! },
          select: { id: true, uuid: true },
        })
      : [];
    const existingByUuid = new Map(existingRows.map((r) => [r.uuid!, r.id]));

    let created = 0;
    let updated = 0;

    for (const t of ticketArr) {
      const startDate = t.entryBeginAt
        ? new Date(t.entryBeginAt as string)
        : t.beginAt
          ? new Date(t.beginAt as string)
          : undefined;
      const endDate = t.entryEndAt
        ? new Date(t.entryEndAt as string)
        : t.endAt
          ? new Date(t.endAt as string)
          : undefined;

      const barcode = (t.masterBarcode || t.barcode) as string | undefined;

      const ticketData = {
        name: `${t.firstName || ""} ${t.lastName || ""}`.trim() || "Binarytec Ticket",
        barcode,
        qrCode: barcode,
        firstName: t.firstName as string | undefined,
        lastName: t.lastName as string | undefined,
        startDate,
        endDate,
        status: t.isValid === 1 ? ("VALID" as const) : ("INVALID" as const),
        ticketTypeName: t.ticketTypeName as string | undefined,
        source: "BINARYTEC" as const,
      };

      const existingId = typeof t.uuid === "string" ? existingByUuid.get(t.uuid) : undefined;

      if (existingId) {
        await db.ticket.update({ where: { id: existingId }, data: ticketData });
        updated++;
      } else if (t.isValid === 1 && typeof t.uuid === "string") {
        await db.ticket.create({
          data: { ...ticketData, uuid: t.uuid, accountId: accountId! },
        });
        created++;
      }
    }

    await db.apiConfig.update({
      where: { id: config.id },
      data: { lastUpdate: new Date() },
    });

    return NextResponse.json({ created, updated });
  } catch (err) {
    return NextResponse.json(
      { error: `Sync failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }
}
