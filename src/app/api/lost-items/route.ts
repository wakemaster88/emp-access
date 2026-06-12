import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { lostItemCreateSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const filter = request.nextUrl.searchParams.get("filter"); // "open" | "pickedUp" | null

  const items = await db.lostItem.findMany({
    where: {
      accountId: accountId!,
      ...(filter === "open" && { pickedUp: false }),
      ...(filter === "pickedUp" && { pickedUp: true }),
    },
    orderBy: { foundDate: "desc" },
  });
  return NextResponse.json(items);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const parsed = lostItemCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  const item = await db.lostItem.create({
    data: {
      description: data.description.trim(),
      foundDate: new Date(data.foundDate),
      image: data.image ?? null,
      contact: data.contact?.trim() || null,
      pickedUp: data.pickedUp ?? false,
      pickedUpAt: data.pickedUp ? new Date() : null,
      accountId: accountId!,
    },
  });
  return NextResponse.json(item, { status: 201 });
}
