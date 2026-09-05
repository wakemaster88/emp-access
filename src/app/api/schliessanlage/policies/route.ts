import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { keyPolicyCreateSchema } from "@/lib/validators";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const policies = await db.keyPolicyTemplate.findMany({
    where: { accountId: accountId! },
    orderBy: [{ name: "asc" }, { version: "desc" }],
  });
  return NextResponse.json(policies);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  }

  const parsed = keyPolicyCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db, accountId } = session;
  const data = parsed.data;
  const name = data.name.trim();

  // Gleicher Name = neue Version derselben Vorlage.
  const latest = await db.keyPolicyTemplate.findFirst({
    where: { accountId, name },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;
  const isActive = data.isActive ?? true;

  // Roher Client in einer Transaktion; alle Filter tragen den accountId.
  const policy = await prisma.$transaction(async (tx) => {
    if (isActive) {
      await tx.keyPolicyTemplate.updateMany({
        where: { accountId, name },
        data: { isActive: false },
      });
    }
    return tx.keyPolicyTemplate.create({
      data: {
        accountId,
        name,
        version,
        bodyText: data.bodyText.trim(),
        liabilityText: data.liabilityText?.trim() || null,
        isActive,
      },
    });
  });

  return NextResponse.json(policy, { status: 201 });
}
