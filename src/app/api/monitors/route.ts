import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const monitors = await db.monitorConfig.findMany({
    where: { accountId: accountId! },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(monitors);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  }

  const { db, accountId } = session;
  const monitor = await db.monitorConfig.create({
    data: {
      name: body.name.trim(),
      deviceIds: body.deviceIds ?? [],
      isActive: body.isActive ?? true,
      accountId: accountId!,
    },
  });
  return NextResponse.json(monitor, { status: 201 });
}
