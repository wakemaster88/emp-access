import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { parseStreamUrl } from "@/lib/audio-integration";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const streams = await db.audioStream.findMany({
    where: { accountId: accountId! },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(streams);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const body = await request.json();

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name erforderlich" }, { status: 400 });

  const parsed = parseStreamUrl(body.url);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const stream = await db.audioStream.create({
    data: { accountId: accountId!, name, url: parsed.url },
  });
  return NextResponse.json(stream, { status: 201 });
}
