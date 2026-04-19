import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { vereinCreateSchema } from "@/lib/validators";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const vereine = await db.verein.findMany({
    where: { accountId: accountId! },
    include: {
      areas: { include: { accessArea: { select: { id: true, name: true } } } },
      _count: { select: { members: true } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(vereine);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const parsed = vereinCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;
  const areaIds = data.areaIds ?? [];
  const memberIds = data.memberTicketIds ?? [];

  try {
    const verein = await db.verein.create({
      data: {
        name: data.name.trim(),
        description: data.description ?? null,
        accountId: accountId!,
        ...(areaIds.length > 0 && {
          areas: {
            create: areaIds.map((accessAreaId) => ({ accessAreaId })),
          },
        }),
        ...(memberIds.length > 0 && {
          members: { connect: memberIds.map((id) => ({ id })) },
        }),
      },
      include: {
        areas: { include: { accessArea: { select: { id: true, name: true } } } },
        _count: { select: { members: true } },
      },
    });
    return NextResponse.json(verein, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "Ein Verein mit diesem Namen existiert bereits" }, { status: 409 });
    }
    throw e;
  }
}
