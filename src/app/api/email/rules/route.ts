import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { emailRuleCreateSchema } from "@/lib/validators";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const rules = await db.emailRule.findMany({
    where: { accountId: accountId! },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });

  const sentByRule = new Map<number, number>();
  await Promise.all(
    rules.map(async (r) => {
      const count = await db.emailSend.count({
        where: { accountId: accountId!, ruleId: r.id, status: "SENT" },
      });
      sentByRule.set(r.id, count);
    }),
  );

  return NextResponse.json({
    rules: rules.map((r) => ({
      ...r,
      sentCount: sentByRule.get(r.id) ?? 0,
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json().catch(() => ({}));
  const parsed = emailRuleCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const rule = await db.emailRule.create({
    data: {
      accountId: accountId!,
      name: data.name,
      trigger: data.trigger,
      daysOffset: data.daysOffset,
      subscriptionId: data.subscriptionId ?? null,
      serviceId: data.serviceId ?? null,
      subject: data.subject,
      bodyHtml: data.bodyHtml,
      createVoucher: data.createVoucher ?? false,
      voucherDiscountPercent: data.voucherDiscountPercent ?? null,
      voucherValidDays: data.voucherValidDays ?? null,
      voucherTicketTypeName: data.voucherTicketTypeName ?? null,
      renewUrl: data.renewUrl ?? null,
      isActive: data.isActive ?? true,
      cooldownDays: data.cooldownDays ?? 30,
      lookbackDays: data.lookbackDays ?? 7,
    },
  });

  return NextResponse.json({ rule }, { status: 201 });
}
