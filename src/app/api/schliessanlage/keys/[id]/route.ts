import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { keyItemInclude } from "@/lib/keying-queries";
import { keyItemUpdateSchema } from "@/lib/validators";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const keyId = Number((await params).id);
  if (isNaN(keyId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const parsed = keyItemUpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const existing = await db.keyItem.findFirst({ where: { id: keyId, accountId } });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const data = parsed.data;

  // Ein ausgegebener Schluessel darf nicht per Hand auf "im Bestand" gesetzt
  // werden – das laeuft ueber die Ruecknahme im Protokoll.
  if (data.status === "AVAILABLE" && existing.status === "ISSUED") {
    return NextResponse.json(
      { error: "Schlüssel ist ausgegeben – bitte über das Protokoll zurücknehmen" },
      { status: 409 },
    );
  }

  if (data.lockIds !== undefined && data.lockIds.length > 0) {
    const found = await db.keyLock.count({ where: { id: { in: data.lockIds }, accountId } });
    if (found !== data.lockIds.length) {
      return NextResponse.json({ error: "Unbekanntes Schloss ausgewählt" }, { status: 400 });
    }
  }

  try {
    const key = await db.keyItem.update({
      where: { id: keyId },
      data: {
        ...(data.keyNumber !== undefined && { keyNumber: data.keyNumber.trim() }),
        ...(data.label !== undefined && { label: data.label?.trim() || null }),
        ...(data.level !== undefined && { level: data.level }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
        ...(data.lockIds !== undefined && {
          locks: {
            deleteMany: {},
            create: data.lockIds.map((lockId) => ({ lockId })),
          },
        }),
      },
      include: keyItemInclude,
    });
    return NextResponse.json(key);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "Diese Schlüsselnummer ist bereits vergeben" },
        { status: 409 },
      );
    }
    throw e;
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const keyId = Number((await params).id);
  if (isNaN(keyId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const existing = await db.keyItem.findFirst({
    where: { id: keyId, accountId },
    include: { _count: { select: { handovers: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Protokolleintraege sind Nachweise – ein Schluessel mit Historie wird
  // stillgelegt statt geloescht.
  if (existing._count.handovers > 0) {
    const key = await db.keyItem.update({
      where: { id: keyId },
      data: { status: "DESTROYED" },
    });
    return NextResponse.json({ ok: true, archived: true, key });
  }

  await db.keyItem.delete({ where: { id: keyId } });
  return NextResponse.json({ ok: true, archived: false });
}
