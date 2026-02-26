import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  provider: z.enum(["ANNY", "WAKESYS", "BINARYTEC", "EMP_CONTROL"]),
  token: z.string().min(1),
  eventId: z.string().optional().nullable(),
  baseUrl: z.string().url().optional().nullable().or(z.literal("")),
  extraConfig: z.string().optional().nullable(),
});

async function getSession(req: NextRequest) {
  const session = await safeAuth();
  if (!session?.user || !session.user.accountId) return null;
  return session;
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = tenantClient(session.user.accountId!);
  const configs = await db.apiConfig.findMany({
    where: { accountId: session.user.accountId! },
    orderBy: { provider: "asc" },
  });

  return NextResponse.json(configs);
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = tenantClient(session.user.accountId!);

  const existing = await db.apiConfig.findFirst({
    where: { accountId: session.user.accountId!, provider: parsed.data.provider },
  });

  if (existing) {
    const updated = await db.apiConfig.update({
      where: { id: existing.id },
      data: {
        token: parsed.data.token,
        eventId: parsed.data.eventId ?? null,
        baseUrl: parsed.data.baseUrl || null,
        extraConfig: parsed.data.extraConfig ?? null,
        lastUpdate: new Date(),
      },
    });
    return NextResponse.json(updated);
  }

  const config = await db.apiConfig.create({
    data: {
      accountId: session.user.accountId!,
      provider: parsed.data.provider,
      token: parsed.data.token,
      eventId: parsed.data.eventId ?? null,
      baseUrl: parsed.data.baseUrl || null,
      extraConfig: parsed.data.extraConfig ?? null,
    },
  });

  return NextResponse.json(config, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const provider = searchParams.get("provider");
  if (!provider) return NextResponse.json({ error: "Provider fehlt" }, { status: 400 });

  const db = tenantClient(session.user.accountId!);
  await db.apiConfig.deleteMany({
    where: { accountId: session.user.accountId!, provider: provider as never },
  });

  return NextResponse.json({ ok: true });
}
