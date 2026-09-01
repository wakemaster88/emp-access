import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { buildKeyNumberSeries } from "@/lib/keying";
import { keyItemInclude } from "@/lib/keying-queries";
import { keyItemBulkCreateSchema } from "@/lib/validators";

/** Legt eine Nummernserie gleichartiger Schluessel an ("Z12-1" ... "Z12-5"). */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const parsed = keyItemBulkCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;

  const lockIds = data.lockIds ?? [];
  if (lockIds.length > 0) {
    const found = await db.keyLock.count({ where: { id: { in: lockIds }, accountId } });
    if (found !== lockIds.length) {
      return NextResponse.json({ error: "Unbekanntes Schloss ausgewählt" }, { status: 400 });
    }
  }

  const numbers = buildKeyNumberSeries({
    prefix: data.prefix.trim(),
    count: data.count,
    startIndex: data.startIndex,
    separator: data.separator,
    padding: data.padding,
  });

  const taken = await db.keyItem.findMany({
    where: { accountId, keyNumber: { in: numbers } },
    select: { keyNumber: true },
  });
  if (taken.length > 0) {
    return NextResponse.json(
      { error: `Bereits vergeben: ${taken.map((t) => t.keyNumber).join(", ")}` },
      { status: 409 },
    );
  }

  const created = await db.$transaction(
    numbers.map((keyNumber) =>
      db.keyItem.create({
        data: {
          accountId,
          keyNumber,
          label: data.label?.trim() || null,
          level: data.level ?? "SINGLE",
          notes: data.notes?.trim() || null,
          locks: { create: lockIds.map((lockId) => ({ lockId })) },
        },
        include: keyItemInclude,
      }),
    ),
  );

  return NextResponse.json({ created: created.length, keys: created }, { status: 201 });
}
