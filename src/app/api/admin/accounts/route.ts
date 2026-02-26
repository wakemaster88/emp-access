import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/auth";
import { superAdminClient } from "@/lib/prisma";
import { accountCreateSchema } from "@/lib/validators";

async function requireSuperAdmin() {
  const session = await safeAuth();
  if (!session?.user || session.user.role !== "SUPER_ADMIN") return null;
  return session;
}

export async function GET() {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const accounts = await superAdminClient.account.findMany({
    include: {
      _count: { select: { admins: true, devices: true, tickets: true, scans: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(accounts);
}

export async function POST(request: NextRequest) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await request.json();
  const parsed = accountCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await superAdminClient.account.findUnique({
    where: { subdomain: parsed.data.subdomain },
  });
  if (existing) {
    return NextResponse.json({ error: "Subdomain bereits vergeben" }, { status: 409 });
  }

  const account = await superAdminClient.account.create({
    data: {
      name: parsed.data.name,
      subdomain: parsed.data.subdomain,
      isActive: parsed.data.isActive ?? true,
    },
  });

  return NextResponse.json(account, { status: 201 });
}
