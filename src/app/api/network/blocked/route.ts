import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { normalizeMac } from "@/lib/mac";

/** Sperrliste: alle gesperrten Geraete. */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  const rows = await db.blockedNetworkDevice.findMany({
    where: { accountId: accountId! },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(rows);
}

/** Geraet sperren (MAC + Name). Gibt es die MAC schon, werden Name/Grund aktualisiert. */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json().catch(() => ({}));
  const mac = normalizeMac(body.macAddress);
  if (!mac) return NextResponse.json({ error: "Ungültige MAC-Adresse" }, { status: 400 });
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  const reason =
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
  const enforcedAt = body.enforced === true ? new Date() : undefined;

  const row = await db.blockedNetworkDevice.upsert({
    where: { accountId_macAddress: { accountId: accountId!, macAddress: mac } },
    create: { macAddress: mac, name, reason, enforcedAt: enforcedAt ?? null, accountId: accountId! },
    update: { name, reason, ...(enforcedAt ? { enforcedAt } : {}) },
  });
  return NextResponse.json(row, { status: 201 });
}
