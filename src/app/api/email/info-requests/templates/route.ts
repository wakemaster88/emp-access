import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  FERIENKURS_DEFAULT_TEMPLATE,
  infoTemplateCreateSchema,
} from "@/lib/info-request";

/**
 * POST – Info-Formular-Template anlegen. Ohne Body-Felder wird die
 * Ferienkurs-Default-Vorlage erstellt (Schnell-Setup im Dashboard).
 */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json().catch(() => ({}));

  // Schnell-Setup: {"preset": "ferienkurs"} erstellt die Default-Vorlage.
  if (body?.preset === "ferienkurs") {
    const existing = await db.infoFormTemplate.findFirst({
      where: { accountId: accountId!, name: FERIENKURS_DEFAULT_TEMPLATE.name },
    });
    if (existing) return NextResponse.json({ template: existing });
    const template = await db.infoFormTemplate.create({
      data: {
        accountId: accountId!,
        name: FERIENKURS_DEFAULT_TEMPLATE.name,
        introText: FERIENKURS_DEFAULT_TEMPLATE.introText,
        fields: FERIENKURS_DEFAULT_TEMPLATE.fields,
        askParticipantName: FERIENKURS_DEFAULT_TEMPLATE.askParticipantName,
      },
    });
    return NextResponse.json({ template }, { status: 201 });
  }

  const parsed = infoTemplateCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const template = await db.infoFormTemplate.create({
    data: {
      accountId: accountId!,
      name: data.name,
      introText: data.introText ?? null,
      fields: data.fields,
      askParticipantName: data.askParticipantName ?? true,
    },
  });
  return NextResponse.json({ template }, { status: 201 });
}
