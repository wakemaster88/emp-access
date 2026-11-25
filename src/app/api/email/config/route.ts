import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb, isTenantAdminRole } from "@/lib/api-auth";
import { emailConfigUpdateSchema } from "@/lib/validators";
import { maskSecret } from "@/lib/secret-mask";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const config = await db.emailConfig.findUnique({
    where: { accountId: accountId! },
  });
  if (!config) {
    return NextResponse.json({ config: null });
  }

  // API-Key beim Lesen maskieren („••••“ plus die letzten 4 Zeichen), und das
  // nur fuer Verwaltungs-Rollen; USER erfaehrt nur, ob einer hinterlegt ist.
  const apiKeyMasked = config.apiKey && isTenantAdminRole(session.session.user.role)
    ? maskSecret(config.apiKey)
    : null;

  return NextResponse.json({
    config: {
      ...config,
      apiKey: apiKeyMasked,
      hasApiKey: !!config.apiKey,
    },
  });
}

export async function PUT(request: NextRequest) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json().catch(() => ({}));
  const parsed = emailConfigUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const existing = await db.emailConfig.findUnique({
    where: { accountId: accountId! },
  });

  // apiKey: leerer String oder undefined → unverändert lassen, null → löschen.
  const apiKeyValue =
    data.apiKey === undefined
      ? existing?.apiKey ?? null
      : data.apiKey === null
        ? null
        : data.apiKey;

  const config = await db.emailConfig.upsert({
    where: { accountId: accountId! },
    create: {
      accountId: accountId!,
      provider: data.provider ?? "GMAIL",
      apiKey: apiKeyValue,
      fromEmail: data.fromEmail,
      fromName: data.fromName ?? null,
      replyTo: data.replyTo ?? null,
      isActive: data.isActive ?? true,
      brandColor: data.brandColor ?? null,
      logoUrl: data.logoUrl ?? null,
      websiteUrl: data.websiteUrl ?? null,
      legalFooter: data.legalFooter?.trim() || null,
    },
    update: {
      provider: data.provider ?? existing?.provider ?? "GMAIL",
      apiKey: apiKeyValue,
      fromEmail: data.fromEmail,
      fromName: data.fromName ?? null,
      replyTo: data.replyTo ?? null,
      isActive: data.isActive ?? existing?.isActive ?? true,
      brandColor: data.brandColor ?? null,
      logoUrl: data.logoUrl ?? null,
      websiteUrl: data.websiteUrl ?? null,
      legalFooter: data.legalFooter === undefined ? existing?.legalFooter ?? null : data.legalFooter?.trim() || null,
    },
  });

  return NextResponse.json({
    config: {
      ...config,
      apiKey: config.apiKey ? maskSecret(config.apiKey) : null,
      hasApiKey: !!config.apiKey,
    },
  });
}

export async function DELETE() {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  await db.emailConfig
    .delete({ where: { accountId: accountId! } })
    .catch(() => null);

  return NextResponse.json({ ok: true });
}
