import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

/**
 * POST (Hub, Token-Auth): Rueckmeldung eines Offenhalte-Impulses.
 * Body: { pulsedAt: ISO, ok: boolean, error?: string }
 * Bei Erfolg wird doorHoldPulseAt gesetzt (und lastSeenAt, die DoorBird hat
 * geantwortet); bei Fehler nur doorHoldError. Die UI zeigt beides an.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const { id } = await params;
  const cameraId = Number(id);
  if (!Number.isInteger(cameraId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const camera = await db.camera.findFirst({
    where: { id: cameraId, accountId: account.id, kind: "DOORBIRD" },
    select: { id: true },
  });
  if (!camera) return NextResponse.json({ error: "DoorBird nicht gefunden" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as {
    pulsedAt?: unknown;
    ok?: unknown;
    error?: unknown;
  };
  const pulsedAtMs = Date.parse(String(body.pulsedAt ?? ""));
  const pulsedAt = Number.isFinite(pulsedAtMs) ? new Date(pulsedAtMs) : new Date();
  const ok = body.ok === true;
  const error = ok ? null : String(body.error ?? "Impuls fehlgeschlagen").slice(0, 300);

  await db.camera.update({
    where: { id: camera.id },
    data: ok
      ? { doorHoldPulseAt: pulsedAt, doorHoldError: null, lastSeenAt: pulsedAt }
      : { doorHoldError: error },
    select: { id: true },
  });
  return NextResponse.json({ ok: true });
}
