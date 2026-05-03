import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { emailTestSchema } from "@/lib/validators";
import { sendEmail } from "@/lib/email-sender";
import { wrapEmailHtml } from "@/lib/email-templates";

/**
 * Sendet eine Test-Mail über die gespeicherte EmailConfig des Accounts.
 * Die Mail wird zur Nachvollziehbarkeit als `EmailSend` mit Status `TEST`
 * geloggt.
 */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json().catch(() => ({}));
  const parsed = emailTestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { to, subject } = parsed.data;

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

  const finalSubject = subject ?? `Test-Mail von ${account?.name ?? "EMP Access"}`;
  const innerHtml = `
<p>Hallo!</p>
<p>Dies ist eine Test-Mail von <strong>${account?.name ?? "EMP Access"}</strong>.</p>
<p>Wenn du diese Nachricht siehst, ist deine Email-Konfiguration korrekt eingerichtet.</p>
<p>Sportliche Grüße,<br/>dein ${account?.name ?? "EMP"}-Team</p>`;
  const html = wrapEmailHtml({
    innerHtml,
    brandColor: config.brandColor,
    logoUrl: config.logoUrl,
    websiteUrl: config.websiteUrl,
    accountName: account?.name,
    preheader: finalSubject,
  });

  const result = await sendEmail({
    config: {
      provider: config.provider,
      apiKey: config.apiKey,
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      replyTo: config.replyTo,
    },
    to,
    subject: finalSubject,
    html,
  });

  await db.emailSend.create({
    data: {
      accountId: accountId!,
      to,
      subject: finalSubject,
      status: result.ok ? "TEST" : "FAILED",
      errorMessage: result.ok ? null : (result.error?.slice(0, 500) ?? "unbekannter Fehler"),
    },
  });

  return NextResponse.json({
    ok: result.ok,
    error: result.error,
    id: result.id,
  });
}
