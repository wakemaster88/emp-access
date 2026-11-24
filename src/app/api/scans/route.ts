import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { getSessionWithDb } from "@/lib/api-auth";
import { scanPostSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const hasToken = request.nextUrl.searchParams.has("token") ||
    request.headers.has("authorization");

  let db, accountId: number;

  if (hasToken) {
    const auth = await validateApiToken(request);
    if ("error" in auth) return auth.error;
    db = auth.db;
    accountId = auth.account.id;
  } else {
    const session = await getSessionWithDb();
    if ("error" in session) return session.error;
    db = session.db;
    accountId = session.accountId!;
  }

  const limit = Number(request.nextUrl.searchParams.get("limit") || "50");
  const offset = Number(request.nextUrl.searchParams.get("offset") || "0");

  // Enge Auswahl: Geraet und Ticket nur mit Anzeige-Feldern, ohne
  // Zugangsdaten (Geraete-Token, Shelly-Schluessel, Mobil-Link) und ohne
  // Kundendaten wie Foto oder Geburtsdatum. Der Mandanten-Filter greift nur
  // auf oberster Ebene; ein Geraet oder Ticket eines anderen Mandanten wird
  // deshalb unten zusaetzlich ausgeblendet.
  const scans = await db.scan.findMany({
    where: { accountId },
    include: {
      device: { select: { id: true, name: true, type: true, category: true, accountId: true } },
      ticket: {
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
          ticketTypeName: true,
          status: true,
          accountId: true,
        },
      },
    },
    orderBy: { scanTime: "desc" },
    take: Math.min(limit, 200),
    skip: offset,
  });

  return NextResponse.json(scans.map((scan) => ({
    ...scan,
    device: scan.device && scan.device.accountId === accountId ? scan.device : null,
    ticket: scan.ticket && scan.ticket.accountId === accountId ? scan.ticket : null,
  })));
}

export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const parsed = scanPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { db } = auth;

  // Nur Geraete des eigenen Mandanten verknuepfen; unbekannte oder fremde
  // Geraete-IDs werden als Scan ohne Geraet gespeichert.
  const requestedDeviceIds = [...new Set(parsed.data.map((scan) => scan.sca_location))];
  const ownDevices = requestedDeviceIds.length
    ? await db.device.findMany({
        where: { id: { in: requestedDeviceIds }, accountId: auth.account.id },
        select: { id: true },
      })
    : [];
  const ownDeviceIds = new Set(ownDevices.map((d) => d.id));

  const rows = parsed.data.map((scan) => ({
    code: scan.sca_code,
    deviceId: ownDeviceIds.has(scan.sca_location) ? scan.sca_location : null,
    scanTime: new Date(scan.sca_scan_time * 1000),
    result: (scan.sca_grant === 1
      ? "GRANTED"
      : scan.sca_grant === 9
        ? "PROTECTED"
        : "DENIED") as "GRANTED" | "PROTECTED" | "DENIED",
    accountId: auth.account.id,
  }));

  // Einzel-Inserts → ein createManyAndReturn spart bei N Scans N−1 Roundtrips.
  const inserted = rows.length
    ? await db.scan.createManyAndReturn({ data: rows, select: { id: true } })
    : [];

  return NextResponse.json({
    inserted: inserted.length,
    ids: inserted.map((r) => r.id),
  });
}
