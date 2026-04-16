import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { shellyGroupCreateSchema } from "@/lib/validators";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const groups = await db.shellyGroup.findMany({
    where: { accountId: accountId! },
    include: {
      members: {
        include: {
          device: {
            select: { id: true, name: true, category: true, ipAddress: true },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
      _count: { select: { automations: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json(groups);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json();
  const parsed = shellyGroupCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Sicherheits-Check: Alle Member-Devices müssen dem Account gehören und SHELLY sein.
  if (parsed.data.members.length > 0) {
    const deviceIds = parsed.data.members.map((m) => m.deviceId);
    const valid = await db.device.findMany({
      where: { id: { in: deviceIds }, accountId: accountId!, type: "SHELLY" },
      select: { id: true },
    });
    if (valid.length !== new Set(deviceIds).size) {
      return NextResponse.json(
        { error: "Ein oder mehrere Geräte sind keine Shelly-Geräte oder geh\u00f6ren nicht zum Mandanten" },
        { status: 400 }
      );
    }
  }

  const group = await db.shellyGroup.create({
    data: {
      accountId: accountId!,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      sortOrder: parsed.data.sortOrder ?? 0,
      members: {
        create: parsed.data.members.map((m, idx) => ({
          deviceId: m.deviceId,
          action: m.action,
          timerSeconds: m.timerSeconds ?? null,
          sortOrder: m.sortOrder ?? idx,
        })),
      },
    },
    include: { members: { include: { device: true } } },
  });

  return NextResponse.json(group, { status: 201 });
}
