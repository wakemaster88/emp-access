import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb, validateApiOrIntegrationToken } from "@/lib/api-auth";
import { parseScanLockSeconds } from "@/lib/scan-lock";
import { foreignRefError } from "@/lib/tenant-refs";

function hasApiToken(request: NextRequest) {
  return request.nextUrl.searchParams.has("token") || request.headers.has("authorization");
}

export async function GET(request: NextRequest) {
  let db, accountId: number;
  if (hasApiToken(request)) {
    const auth = await validateApiOrIntegrationToken(request, "/api/areas");
    if ("error" in auth) return auth.error;
    db = auth.db;
    accountId = auth.account.id;
  } else {
    const session = await getSessionWithDb();
    if ("error" in session) return session.error;
    db = session.db;
    accountId = session.accountId!;
  }
  const areas = await db.accessArea.findMany({
    where: { accountId },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(areas);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;

  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  }

  const { db, accountId } = session;
  const parentId = body.parentId ? Number(body.parentId) : null;
  // Uebergeordneter Bereich muss zum Mandanten gehoeren.
  const refError = await foreignRefError(db, accountId, { accessAreaIds: [parentId] });
  if (refError) return NextResponse.json({ error: refError }, { status: 400 });

  const area = await db.accessArea.create({
    data: {
      name: body.name.trim(),
      parentId,
      allowReentry: body.allowReentry ?? false,
      personLimit: body.personLimit ? Number(body.personLimit) : null,
      scanLockSeconds: parseScanLockSeconds(body.scanLockSeconds, null),
      // Einlass-Regel „Tickets ohne Bereich …“: nur gesetzt, wenn mitgeschickt.
      ...(typeof body.allowUnassignedTickets === "boolean"
        ? { allowUnassignedTickets: body.allowUnassignedTickets }
        : {}),
      showOnDashboard: body.showOnDashboard ?? true,
      openingHours: body.openingHours || null,
      accountId: accountId!,
    },
  });
  return NextResponse.json(area, { status: 201 });
}
