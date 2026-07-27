import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

const HUB_ONLINE_MS = 5 * 60 * 1000;

/**
 * POST (Session): stoesst einen Netzwerk-Scan auf dem Hub an (NETWORK_SCAN-Task).
 * GET (Session): Status eines Tasks abfragen (?taskId=).
 */
export async function POST() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const hub = await db.hubAgent.findFirst({
    where: { accountId: accountId! },
    orderBy: { lastSeenAt: "desc" },
  });
  if (!hub?.lastSeenAt || Date.now() - hub.lastSeenAt.getTime() > HUB_ONLINE_MS) {
    return NextResponse.json(
      { error: "Hub ist offline oder meldet sich nicht" },
      { status: 503 }
    );
  }

  const existing = await db.hubTask.findFirst({
    where: {
      accountId: accountId!,
      type: "NETWORK_SCAN",
      status: { in: ["PENDING", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return NextResponse.json({
      taskId: existing.id,
      status: existing.status,
      reused: true,
      hubName: hub.name,
    });
  }

  const task = await db.hubTask.create({
    data: {
      type: "NETWORK_SCAN",
      accountId: accountId!,
      status: "PENDING",
    },
  });
  return NextResponse.json(
    { taskId: task.id, status: task.status, reused: false, hubName: hub.name },
    { status: 201 }
  );
}

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const taskId = Number(request.nextUrl.searchParams.get("taskId"));
  if (!Number.isInteger(taskId)) {
    return NextResponse.json({ error: "taskId fehlt" }, { status: 400 });
  }

  const task = await db.hubTask.findFirst({
    where: { id: taskId, accountId: accountId! },
    select: {
      id: true,
      status: true,
      error: true,
      createdAt: true,
      finishedAt: true,
      result: true,
    },
  });
  if (!task) return NextResponse.json({ error: "Task nicht gefunden" }, { status: 404 });

  const result = task.result as { count?: number; devices?: unknown[]; processed?: number; ok?: boolean } | null;
  const deviceCount = Array.isArray(result?.devices)
    ? result.devices.length
    : typeof result?.count === "number"
      ? result.count
      : typeof result?.processed === "number"
        ? result.processed
        : null;

  return NextResponse.json({
    taskId: task.id,
    status: task.status,
    error: task.error,
    createdAt: task.createdAt.toISOString(),
    finishedAt: task.finishedAt?.toISOString() ?? null,
    deviceCount,
  });
}
