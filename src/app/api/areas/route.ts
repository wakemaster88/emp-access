import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const areas = await db.accessArea.findMany({
    where: { accountId: accountId! },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(areas);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  }

  const { db, accountId } = session;
  const area = await db.accessArea.create({
    data: {
      name: body.name.trim(),
      parentId: body.parentId ? Number(body.parentId) : null,
      allowReentry: body.allowReentry ?? false,
      personLimit: body.personLimit ? Number(body.personLimit) : null,
      showOnDashboard: body.showOnDashboard ?? true,
      openingHours: body.openingHours || null,
      accountId: accountId!,
    },
  });
  return NextResponse.json(area, { status: 201 });
}
