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
    let created = 0;
    let updated = 0;

    for (const t of Array.isArray(tickets) ? tickets : []) {
      const existing = await db.ticket.findFirst({ where: { uuid: t.uuid } });

      const startDate = t.entryBeginAt
        ? new Date(t.entryBeginAt)
        : t.beginAt
          ? new Date(t.beginAt)
          : undefined;
      const endDate = t.entryEndAt
        ? new Date(t.entryEndAt)
        : t.endAt
          ? new Date(t.endAt)
          : undefined;

      const barcode = t.masterBarcode || t.barcode;

      const ticketData = {
        name: `${t.firstName || ""} ${t.lastName || ""}`.trim() || "Binarytec Ticket",
        barcode,
        qrCode: barcode,
        firstName: t.firstName,
        lastName: t.lastName,
        startDate,
        endDate,
        status: t.isValid === 1 ? ("VALID" as const) : ("INVALID" as const),
        ticketTypeName: t.ticketTypeName,
        source: "BINARYTEC" as const,
      };

      if (existing) {
        await db.ticket.update({ where: { id: existing.id }, data: ticketData });
        updated++;
      } else if (t.isValid === 1) {
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
