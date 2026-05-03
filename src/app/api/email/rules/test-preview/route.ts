import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { emailRuleTestSchema } from "@/lib/validators";
import { sendEmail } from "@/lib/email-sender";
import {
  buildSampleTemplateVariables,
  renderTemplate,
  wrapEmailHtml,
} from "@/lib/email-templates";

/**
 * Sendet eine Vorschau-/Test-Mail für eine Email-Regel. Anders als der
 * "Jetzt ausführen"-Endpoint wird hier:
 *  - die Mail mit Beispieldaten gerendert (Max Mustermann, fiktive Termine,
 *    Demo-Voucher), egal ob es einen passenden Empfänger gäbe,
 *  - kein Voucher in der DB erzeugt,
 *  - kein Cooldown ausgelöst (Status "TEST" im EmailSend-Log),
 *  - der Empfänger frei wählbar (z. B. die eigene Adresse).
 *
 * Akzeptiert auch ungespeicherte Werte aus dem Editor – sodass man eine
 * Regel testen kann, bevor man sie speichert.
 */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json().catch(() => ({}));
  const parsed = emailRuleTestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const config = await db.emailConfig.findUnique({
    where: { accountId: accountId! },
  });
  if (!config || !config.apiKey || !config.fromEmail) {
    return NextResponse.json(
      { error: "Email-Konfiguration unvollständig oder nicht gespeichert." },
      { status: 400 },
    );
  }

  const account = await db.account.findUnique({
    where: { id: accountId! },
    select: { name: true },
  });

  const vars = buildSampleTemplateVariables({
    trigger: data.trigger,
    daysOffset: data.daysOffset,
    createVoucher: data.createVoucher,
    voucherDiscountPercent: data.voucherDiscountPercent,
    voucherValidDays: data.voucherValidDays,
    renewUrl: data.renewUrl,
    accountName: account?.name,
    brandColor: config.brandColor,
    logoUrl: config.logoUrl,
    websiteUrl: config.websiteUrl,
  });

  const renderedSubject = renderTemplate(data.subject, vars);
  const renderedBody = renderTemplate(data.bodyHtml, vars);
  const previewSubject = `[TEST] ${renderedSubject}`;

  const html = wrapEmailHtml({
    innerHtml: `
<div style="background:#fef3c7;border-left:3px solid #f59e0b;color:#92400e;padding:10px 12px;border-radius:6px;font-size:12px;margin-bottom:18px;">
  <strong>Vorschau-Mail:</strong> Diese Mail wurde mit Beispieldaten (Max Mustermann, ${vars.endDate ?? "—"})
  generiert und nicht an einen echten Empfänger versendet.
</div>
${renderedBody}`,
    brandColor: config.brandColor,
    logoUrl: config.logoUrl,
    websiteUrl: config.websiteUrl,
    accountName: account?.name,
    preheader: renderedSubject,
  });

  const result = await sendEmail({
    config: {
      provider: config.provider,
      apiKey: config.apiKey,
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      replyTo: config.replyTo,
    },
    to: data.to,
    subject: previewSubject,
    html,
  });

  await db.emailSend.create({
    data: {
      accountId: accountId!,
      ruleId: data.ruleId ?? null,
      to: data.to,
      subject: previewSubject,
      status: result.ok ? "TEST" : "FAILED",
      errorMessage: result.ok ? null : (result.error?.slice(0, 500) ?? "unbekannter Fehler"),
    },
  });

  return NextResponse.json({
    ok: result.ok,
    error: result.error,
    id: result.id,
    renderedSubject,
  });
}
