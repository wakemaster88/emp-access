import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const areaId = Number(id);
  if (isNaN(areaId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;

  const links = await db.annyResourceLink.findMany({
    where: { accessAreaId: areaId, accountId: accountId! },
    orderBy: { label: "asc" },
  });

  return NextResponse.json(links);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const areaId = Number(id);
  if (isNaN(areaId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;

  const area = await db.accessArea.findFirst({
    where: { id: areaId, accountId: accountId! },
  });
  if (!area) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body: string[] = await request.json();
  if (!Array.isArray(body)) {
    return NextResponse.json({ error: "Array erwartet" }, { status: 400 });
  }

  const annyConfig = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "ANNY" },
    select: { extraConfig: true },
  });

  let resourceIds: Record<string, string> = {};
  if (annyConfig?.extraConfig) {
    try {
      const parsed = JSON.parse(annyConfig.extraConfig);
      resourceIds = parsed.resourceIds ?? {};
    } catch { /* ignore */ }
  }

  await db.annyResourceLink.deleteMany({
    where: { accessAreaId: areaId, accountId: accountId! },
  });

  function cleanLabel(name: string): string {
    let l = name.replace(/^Wake & Ski\s*-\s*/i, "").trim();
    if (l.includes(" - ")) l = l.split(" - ")[0].trim();
    return l;
  }

  const created = [];
  for (const annyName of body) {
    const rid = resourceIds[annyName];
    if (!rid) continue;

    const label = cleanLabel(annyName);
    const isPublic = /öffentlich/i.test(annyName);

    const link = await db.annyResourceLink.create({
      data: {
        accessAreaId: areaId,
        annyResourceId: rid,
        annyName,
        label,
        isPublic,
        splitSlots: !isPublic,
        accountId: accountId!,
      },
    });
    created.push(link);
  }

  return NextResponse.json(created);
}
