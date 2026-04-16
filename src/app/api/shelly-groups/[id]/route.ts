import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { shellyGroupUpdateSchema } from "@/lib/validators";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  const { id } = await params;

  const group = await db.shellyGroup.findFirst({
    where: { id: Number(id), accountId: accountId! },
    include: {
      members: {
        include: { device: { select: { id: true, name: true, category: true, ipAddress: true } } },
        orderBy: { sortOrder: "asc" },
      },
      automations: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!group) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json(group);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  const { id } = await params;

  const body = await request.json();
  const parsed = shellyGroupUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await db.shellyGroup.findFirst({
    where: { id: Number(id), accountId: accountId! },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Member-Validation (falls übergeben)
  if (parsed.data.members) {
    const deviceIds = parsed.data.members.map((m) => m.deviceId);
    if (deviceIds.length > 0) {
      const valid = await db.device.findMany({
        where: { id: { in: deviceIds }, accountId: accountId!, type: "SHELLY" },
        select: { id: true },
      });
      if (valid.length !== new Set(deviceIds).size) {
        return NextResponse.json(
          { error: "Ein oder mehrere Ger\u00e4te sind keine Shellies oder geh\u00f6ren nicht zum Mandanten" },
          { status: 400 }
        );
      }
    }
  }

  // Members werden komplett ersetzt (einfachstes Modell). Wir nutzen hier
  // bewusst `prisma.$transaction` (nicht `db.$transaction`), da der tenantClient
  // jede Operation in eine eigene Transaktion wrappt – das würde verschachtelte
  // Transaktionen erzeugen. Deshalb setzen wir RLS manuell als erstes Statement.
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${String(accountId)}, TRUE)`;
    if (parsed.data.members !== undefined) {
      await tx.shellyGroupMember.deleteMany({ where: { groupId: Number(id) } });
    }
    return tx.shellyGroup.update({
      where: { id: Number(id) },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
        ...(parsed.data.members !== undefined
          ? {
              members: {
                create: parsed.data.members.map((m, idx) => ({
                  deviceId: m.deviceId,
                  action: m.action,
                  timerSeconds: m.timerSeconds ?? null,
                  sortOrder: m.sortOrder ?? idx,
                })),
              },
            }
          : {}),
      },
      include: {
        members: {
          include: { device: { select: { id: true, name: true, category: true, ipAddress: true } } },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  const { id } = await params;

  const res = await db.shellyGroup.deleteMany({
    where: { id: Number(id), accountId: accountId! },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
