import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/auth";
import { superAdminClient } from "@/lib/prisma";
import { adminCreateSchema } from "@/lib/validators";
import { hash } from "bcryptjs";

async function requireSuperAdmin() {
  const session = await safeAuth();
  if (!session?.user || session.user.role !== "SUPER_ADMIN") return null;
  return session;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;
  const accountId = parseInt(id, 10);
  if (isNaN(accountId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const users = await superAdminClient.admin.findMany({
    where: { accountId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      lastLogin: true,
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(users);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;
  const accountId = parseInt(id, 10);
  if (isNaN(accountId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const account = await superAdminClient.account.findUnique({ where: { id: accountId } });
  if (!account) return NextResponse.json({ error: "Mandant nicht gefunden" }, { status: 404 });

  const body = await request.json();
  const parsed = adminCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await superAdminClient.admin.findUnique({
    where: { email: parsed.data.email },
  });
  if (existing) {
    return NextResponse.json({ error: "E-Mail bereits vergeben" }, { status: 409 });
  }

  const hashed = await hash(parsed.data.password, 12);

  const user = await superAdminClient.admin.create({
    data: {
      email: parsed.data.email,
      password: hashed,
      name: parsed.data.name,
      role: parsed.data.role ?? "USER",
      accountId,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      lastLogin: true,
      createdAt: true,
    },
  });

  return NextResponse.json(user, { status: 201 });
}
