import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { emailConfigUpdateSchema } from "@/lib/validators";

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

  // API-Key beim Lesen maskieren – nur erste 6 Zeichen + Länge.
  const apiKeyMasked = config.apiKey
    ? `${config.apiKey.slice(0, 6)}${"•".repeat(Math.max(0, config.apiKey.length - 6))}`
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
  const session = await getSessionWithDb();
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
    },
  });

  return NextResponse.json({
    config: {
      ...config,
      apiKey: config.apiKey ? `${config.apiKey.slice(0, 6)}${"•".repeat(Math.max(0, config.apiKey.length - 6))}` : null,
      hasApiKey: !!config.apiKey,
    },
  });
}

export async function DELETE() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  await db.emailConfig
    .delete({ where: { accountId: accountId! } })
    .catch(() => null);

  return NextResponse.json({ ok: true });
}
