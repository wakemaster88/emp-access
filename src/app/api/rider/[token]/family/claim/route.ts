import { NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { findRiderAuthProfile, sessionRider } from "@/lib/rider-auth";
import { addFamilyChild, FamilyError } from "@/lib/rider-family";

/**
 * POST: Das Abo hinter diesem Einladungslink (noch ohne eigenen Zugang) als
 * Kind in die Familie der angemeldeten Person holen. Der Link ist die
 * Berechtigung, so wie er auch das Einrichten eines Zugangs erlaubt.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = publicRateLimit(ip, "rider-family-claim", { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const viewer = await sessionRider();
  if (!viewer) return NextResponse.json({ error: "Bitte melde dich zuerst in deiner App an." }, { status: 401 });
  const target = await findRiderAuthProfile(token);
  if (!target || target.accountId !== viewer.accountId) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  try {
    await addFamilyChild(viewer, target.id);
  } catch (e) {
    if (e instanceof FamilyError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
