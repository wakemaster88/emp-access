import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

/**
 * Geräte einer Ressource zuordnen (Einlass und Auslass) – aus dem Dialog
 * „Ressource bearbeiten“, Reiter „Geräte“.
 *
 * Body: `{ in: number[], out: number[] }` – die vollständige Liste der Geräte,
 * die danach an dieser Ressource Einlass bzw. Auslass sind. Ein Gerät hat je
 * Richtung genau eine Ressource: Steht es hier in der Liste, wechselt es von
 * seiner bisherigen Ressource hierher. Ein Gerät, das bisher hier war und nicht
 * mehr in der Liste steht, ist danach in dieser Richtung keiner Ressource
 * zugeordnet. Andere Ressourcen und andere Geräte bleiben unberührt.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;

  const { id } = await params;
  const areaId = Number(id);
  if (!Number.isInteger(areaId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;

  const area = await db.accessArea.findFirst({
    where: { id: areaId, accountId: accountId! },
    select: { id: true },
  });
  if (!area) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parseIds = (raw: unknown): number[] | null => {
    if (!Array.isArray(raw)) return null;
    const ids = raw.map(Number);
    return ids.every((n) => Number.isInteger(n) && n > 0) ? [...new Set(ids)] : null;
  };
  const inIds = parseIds((body as { in?: unknown })?.in);
  const outIds = parseIds((body as { out?: unknown })?.out);
  if (!inIds || !outIds) {
    return NextResponse.json({ error: "Erwartet: { in: number[], out: number[] }" }, { status: 400 });
  }

  const all = [...new Set([...inIds, ...outIds])];
  if (all.length > 0) {
    const found = await db.device.count({ where: { id: { in: all }, accountId: accountId! } });
    if (found !== all.length) {
      return NextResponse.json({ error: "Gerät nicht gefunden" }, { status: 400 });
    }
  }

  await db.$transaction([
    db.device.updateMany({
      where: { accountId: accountId!, accessIn: areaId, id: { notIn: inIds } },
      data: { accessIn: null },
    }),
    db.device.updateMany({
      where: { accountId: accountId!, id: { in: inIds } },
      data: { accessIn: areaId },
    }),
    db.device.updateMany({
      where: { accountId: accountId!, accessOut: areaId, id: { notIn: outIds } },
      data: { accessOut: null },
    }),
    db.device.updateMany({
      where: { accountId: accountId!, id: { in: outIds } },
      data: { accessOut: areaId },
    }),
  ]);

  return NextResponse.json({ ok: true, in: inIds, out: outIds });
}
