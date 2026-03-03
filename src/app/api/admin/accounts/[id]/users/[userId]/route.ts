import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/auth";
import { superAdminClient } from "@/lib/prisma";
import { adminUpdateSchema } from "@/lib/validators";
import { hash } from "bcryptjs";

async function requireSuperAdmin() {
  const session = await safeAuth();
  if (!session?.user || session.user.role !== "SUPER_ADMIN") return null;
  return session;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id, userId } = await params;
  const accountId = parseInt(id, 10);
  const adminId = parseInt(userId, 10);
  if (isNaN(accountId) || isNaN(adminId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const existing = await superAdminClient.admin.findFirst({
    where: { id: adminId, accountId },
  });
  if (!existing) return NextResponse.json({ error: "Benutzer nicht gefunden" }, { status: 404 });

  const body = await request.json();
  const parsed = adminUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.email) {
    const emailTaken = await superAdminClient.admin.findFirst({
      where: { email: parsed.data.email, id: { not: adminId } },
    });
    if (emailTaken) {
      return NextResponse.json({ error: "E-Mail bereits vergeben" }, { status: 409 });
    }
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.email !== undefined) data.email = parsed.data.email;
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.role !== undefined) data.role = parsed.data.role;
  if (parsed.data.password) data.password = await hash(parsed.data.password, 12);

  const user = await superAdminClient.admin.update({
    where: { id: adminId },
    data,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      lastLogin: true,
      createdAt: true,
    },
  });

  return NextResponse.json(user);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id, userId } = await params;
  const accountId = parseInt(id, 10);
  const adminId = parseInt(userId, 10);
  if (isNaN(accountId) || isNaN(adminId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const existing = await superAdminClient.admin.findFirst({
    where: { id: adminId, accountId },
  });
  if (!existing) return NextResponse.json({ error: "Benutzer nicht gefunden" }, { status: 404 });

  if (existing.role === "SUPER_ADMIN") {
    return NextResponse.json({ error: "SUPER_ADMIN kann nicht gelöscht werden" }, { status: 403 });
  }

  await superAdminClient.admin.delete({ where: { id: adminId } });

  return NextResponse.json({ success: true });
}
