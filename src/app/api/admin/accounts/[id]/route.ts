import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/auth";
import { superAdminClient } from "@/lib/prisma";
import { accountUpdateSchema } from "@/lib/validators";

async function requireSuperAdmin() {
  const session = await safeAuth();
  if (!session?.user || session.user.role !== "SUPER_ADMIN") return null;
  return session;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;
  const accountId = parseInt(id, 10);
  if (isNaN(accountId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const parsed = accountUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.subdomain) {
    const existing = await superAdminClient.account.findFirst({
      where: { subdomain: parsed.data.subdomain, id: { not: accountId } },
    });
    if (existing) {
      return NextResponse.json({ error: "Subdomain bereits vergeben" }, { status: 409 });
    }
  }

  const account = await superAdminClient.account.update({
    where: { id: accountId },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.subdomain !== undefined && { subdomain: parsed.data.subdomain }),
      ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
    },
  });

  return NextResponse.json(account);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;
  const accountId = parseInt(id, 10);
  if (isNaN(accountId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  await superAdminClient.account.delete({ where: { id: accountId } });

  return NextResponse.json({ success: true });
}
