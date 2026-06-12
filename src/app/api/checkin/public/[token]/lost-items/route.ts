import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lostItemCreateSchema } from "@/lib/validators";

async function resolveMonitor(token: string) {
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { isActive: true, type: true, accountId: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") return null;
  return monitor;
}

function serialize(item: {
  id: number;
  description: string;
  foundDate: Date;
  image: string | null;
  contact: string | null;
  pickedUp: boolean;
  pickedUpAt: Date | null;
}) {
  return {
    id: item.id,
    description: item.description,
    foundDate: item.foundDate.toISOString(),
    image: item.image,
    contact: item.contact,
    pickedUp: item.pickedUp,
    pickedUpAt: item.pickedUpAt ? item.pickedUpAt.toISOString() : null,
  };
}

/// Fundsachen-Liste für einen Checkin-Monitor (Shop-Monitor).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const monitor = await resolveMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const items = await prisma.lostItem.findMany({
    where: { accountId: monitor.accountId },
    orderBy: [{ pickedUp: "asc" }, { foundDate: "desc" }],
    take: 500,
  });
  return NextResponse.json({ items: items.map(serialize) });
}

/// Fundsache am Shop-Monitor anlegen.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const monitor = await resolveMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();
  const parsed = lostItemCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const item = await prisma.lostItem.create({
    data: {
      description: data.description.trim(),
      foundDate: new Date(data.foundDate),
      image: data.image ?? null,
      contact: data.contact?.trim() || null,
      pickedUp: data.pickedUp ?? false,
      pickedUpAt: data.pickedUp ? new Date() : null,
      accountId: monitor.accountId,
    },
  });
  return NextResponse.json(serialize(item), { status: 201 });
}
