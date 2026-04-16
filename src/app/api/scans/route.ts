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

  const rows = parsed.data.map((scan) => ({
    code: scan.sca_code,
    deviceId: scan.sca_location,
    scanTime: new Date(scan.sca_scan_time * 1000),
    result: (scan.sca_grant === 1
      ? "GRANTED"
      : scan.sca_grant === 9
        ? "PROTECTED"
        : "DENIED") as "GRANTED" | "PROTECTED" | "DENIED",
    accountId: auth.account.id,
  }));

  // Einzel-Inserts → ein createManyAndReturn spart bei N Scans N−1 Roundtrips.
  const inserted = rows.length
    ? await db.scan.createManyAndReturn({ data: rows, select: { id: true } })
    : [];

  return NextResponse.json({
    inserted: inserted.length,
    ids: inserted.map((r) => r.id),
  });
}
