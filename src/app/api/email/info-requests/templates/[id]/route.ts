import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { infoTemplateCreateSchema } from "@/lib/info-request";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const templateId = Number(id);
  if (!Number.isInteger(templateId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const existing = await db.infoFormTemplate.findFirst({
    where: { id: templateId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const parsed = infoTemplateCreateSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const template = await db.infoFormTemplate.update({
    where: { id: templateId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.introText !== undefined ? { introText: data.introText ?? null } : {}),
      ...(data.fields !== undefined ? { fields: data.fields } : {}),
      ...(data.askParticipantName !== undefined
        ? { askParticipantName: data.askParticipantName }
        : {}),
    },
  });
  return NextResponse.json({ template });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const templateId = Number(id);
  if (!Number.isInteger(templateId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const existing = await db.infoFormTemplate.findFirst({
    where: { id: templateId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.infoFormTemplate.delete({ where: { id: templateId } });
  return NextResponse.json({ success: true });
}
