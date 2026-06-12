import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildLostItemUpdateData } from "@/lib/lost-item-data";
import { lostItemUpdateSchema } from "@/lib/validators";

async function resolveMonitor(token: string) {
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { isActive: true, type: true, accountId: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") return null;
  return monitor;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params;
  const monitor = await resolveMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const itemId = Number(id);
  if (isNaN(itemId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const parsed = lostItemUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.lostItem.findFirst({
    where: { id: itemId, accountId: monitor.accountId },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const item = await prisma.lostItem.update({
    where: { id: itemId },
    data: buildLostItemUpdateData(parsed.data, existing),
  });
  return NextResponse.json({
    id: item.id,
    kind: item.kind,
    description: item.description,
    foundDate: item.foundDate.toISOString(),
    image: item.image,
    contact: item.contact,
    reporterName: item.reporterName,
    callbackPhone: item.callbackPhone,
    pickedUp: item.pickedUp,
    pickedUpAt: item.pickedUpAt ? item.pickedUpAt.toISOString() : null,
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params;
  const monitor = await resolveMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const itemId = Number(id);
  if (isNaN(itemId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await prisma.lostItem.findFirst({
    where: { id: itemId, accountId: monitor.accountId },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await prisma.lostItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
