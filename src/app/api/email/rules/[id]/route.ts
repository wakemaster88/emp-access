import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { emailRuleUpdateSchema } from "@/lib/validators";
import { processAccountEmailRules } from "@/lib/email-automation";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const existing = await db.emailRule.findFirst({
    where: { id, accountId: accountId! },
  });
  if (!existing) {
    return NextResponse.json({ error: "Regel nicht gefunden" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = emailRuleUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const rule = await db.emailRule.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.trigger !== undefined && { trigger: data.trigger }),
      ...(data.daysOffset !== undefined && { daysOffset: data.daysOffset }),
      ...(data.subscriptionId !== undefined && { subscriptionId: data.subscriptionId }),
      ...(data.serviceId !== undefined && { serviceId: data.serviceId }),
      ...(data.subject !== undefined && { subject: data.subject }),
      ...(data.bodyHtml !== undefined && { bodyHtml: data.bodyHtml }),
      ...(data.createVoucher !== undefined && { createVoucher: data.createVoucher }),
      ...(data.voucherDiscountPercent !== undefined && {
        voucherDiscountPercent: data.voucherDiscountPercent,
      }),
      ...(data.voucherValidDays !== undefined && { voucherValidDays: data.voucherValidDays }),
      ...(data.voucherTicketTypeName !== undefined && {
        voucherTicketTypeName: data.voucherTicketTypeName,
      }),
      ...(data.renewUrl !== undefined && { renewUrl: data.renewUrl }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.cooldownDays !== undefined && { cooldownDays: data.cooldownDays }),
    },
  });

  return NextResponse.json({ rule });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const existing = await db.emailRule.findFirst({
    where: { id, accountId: accountId! },
  });
  if (!existing) {
    return NextResponse.json({ error: "Regel nicht gefunden" }, { status: 404 });
  }

  await db.emailRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

/**
 * Manuelle Auslösung einer einzelnen Regel (z. B. „Jetzt versuchen"-Button).
 * Verwendet dieselbe Logik wie der Cron, aber nur für diese eine Regel.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { accountId } = session;

  const result = await processAccountEmailRules(accountId!, { ruleIds: [id] });
  return NextResponse.json(result);
}
