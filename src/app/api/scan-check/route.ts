import { NextRequest, NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { getSessionWithDb } from "@/lib/api-auth";
import { performScanCheck } from "@/lib/scan-check";

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const body = await request.json();
  const code = String(body.code ?? "");
  const accessAreaId = body.accessAreaId ? Number(body.accessAreaId) : undefined;

  const result = await performScanCheck({
    db: db as unknown as PrismaClient,
    accountId: accountId!,
    code,
    accessAreaId,
  });

  return NextResponse.json(result);
}
