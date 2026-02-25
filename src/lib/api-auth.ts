import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient } from "./prisma";
import { auth } from "./auth";

export async function validateApiToken(request: NextRequest) {
  const token =
    request.headers.get("authorization")?.replace("Bearer ", "") ??
    request.nextUrl.searchParams.get("token");

  if (!token) {
    return { error: NextResponse.json({ error: "Missing API token" }, { status: 401 }) };
  }

  const account = await prisma.account.findUnique({
    where: { apiToken: token },
  });

  if (!account || !account.isActive) {
    return { error: NextResponse.json({ error: "Invalid API token" }, { status: 403 }) };
  }

  return { account, db: tenantClient(account.id) };
}

export async function getSessionWithDb() {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const accountId = session.user.accountId;

  if (!isSuperAdmin && !accountId) {
    return { error: NextResponse.json({ error: "No account assigned" }, { status: 403 }) };
  }

  const db = isSuperAdmin ? prisma : tenantClient(accountId!);

  return { session, db, isSuperAdmin, accountId };
}
