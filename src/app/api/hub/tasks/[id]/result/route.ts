import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

/** Hub meldet das Ergebnis eines Tasks zurueck (Token-Auth). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const { id } = await params;
  const taskId = Number(id);
  if (isNaN(taskId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const task = await db.hubTask.findFirst({
    where: { id: taskId, accountId: account.id },
  });
  if (!task) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const success = body.success !== false;

  const updated = await db.hubTask.update({
    where: { id: taskId },
    data: {
      status: success ? "DONE" : "FAILED",
      result: body.result ?? undefined,
      error: success ? null : (body.error || "Unbekannter Fehler"),
      finishedAt: new Date(),
    },
  });
  return NextResponse.json(updated);
}
