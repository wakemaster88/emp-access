import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { getSessionWithDb } from "@/lib/api-auth";
import { scanPostSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const hasToken = request.nextUrl.searchParams.has("token") ||
    request.headers.has("authorization");

  let db, accountId: number;

  if (hasToken) {
    const auth = await validateApiToken(request);
    if ("error" in auth) return auth.error;
    db = auth.db;
    accountId = auth.account.id;
  } else {
    const session = await getSessionWithDb();
    if ("error" in session) return session.error;
    db = session.db;
    accountId = session.accountId!;
  }

  const limit = Number(request.nextUrl.searchParams.get("limit") || "50");
  const offset = Number(request.nextUrl.searchParams.get("offset") || "0");

  const scans = await db.scan.findMany({
    where: { accountId },
    include: { device: true, ticket: true },
    orderBy: { scanTime: "desc" },
    take: Math.min(limit, 200),
    skip: offset,
  });

  return NextResponse.json(scans);
}

export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const parsed = scanPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { db } = auth;
  const results = [];

  for (const scan of parsed.data) {
    const result = await db.scan.create({
      data: {
        code: scan.sca_code,
        deviceId: scan.sca_location,
        scanTime: new Date(scan.sca_scan_time * 1000),
        result: scan.sca_grant === 1 ? "GRANTED" : scan.sca_grant === 9 ? "PROTECTED" : "DENIED",
        accountId: auth.account.id,
      },
    });
    results.push(result.id);
  }

  return NextResponse.json({ inserted: results.length, ids: results });
}
