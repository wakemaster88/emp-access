import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb, validateApiToken } from "@/lib/api-auth";

function hasApiToken(request: NextRequest) {
  return request.nextUrl.searchParams.has("token") || request.headers.has("authorization");
}

const VALID_TASK_TYPES = [
  "PING",
  "NETWORK_SCAN",
  "WAKE_ON_LAN",
  "CAMERA_SNAPSHOT",
  "FACE_ENROLL",
  "DOORBIRD_OPEN",
];

/**
 * GET (Hub, Token-Auth): holt offene Tasks ab und markiert sie als RUNNING.
 * GET (Session): listet die letzten Tasks fuer die UI.
 */
export async function GET(request: NextRequest) {
  if (hasApiToken(request)) {
    const auth = await validateApiToken(request);
    if ("error" in auth) return auth.error;
    const { db, account } = auth;

    const pending = await db.hubTask.findMany({
      where: { accountId: account.id, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    if (pending.length > 0) {
      await db.hubTask.updateMany({
        where: { id: { in: pending.map((t) => t.id) } },
        data: { status: "RUNNING", startedAt: new Date() },
      });
    }
    return NextResponse.json(pending);
  }

  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const tasks = await session.db.hubTask.findMany({
    where: { accountId: session.accountId! },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(tasks);
}

/** POST (Session-Auth): legt einen neuen Task fuer den Hub an. */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json();
  if (!VALID_TASK_TYPES.includes(body.type)) {
    return NextResponse.json({ error: "Ungültiger Task-Typ" }, { status: 400 });
  }

  const task = await db.hubTask.create({
    data: {
      type: body.type,
      payload: body.payload ?? undefined,
      accountId: accountId!,
    },
  });
  return NextResponse.json(task, { status: 201 });
}
