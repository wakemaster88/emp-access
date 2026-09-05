import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

/**
 * GET (Session): ein einzelner Hub-Task mit Status und Ergebnis.
 * Die UI pollt damit z. B. den Log-Abruf (HUB_LOG), statt die ganze
 * Task-Liste samt Scan-Ergebnissen zu laden.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isInteger(taskId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const task = await db.hubTask.findFirst({
    where: { id: taskId, accountId: accountId! },
    select: {
      id: true,
      type: true,
      status: true,
      result: true,
      error: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
    },
  });
  if (!task) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json(task);
}
